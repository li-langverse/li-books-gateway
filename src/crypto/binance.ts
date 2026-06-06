import { createHmac, randomUUID } from "node:crypto";
import type { CryptoTransaction } from "./types.js";
import { HttpClient, type FetchFn } from "./http-client.js";

const BINANCE_API = process.env.BINANCE_API_URL?.trim() || "https://api.binance.com";

export type BinanceCredentials = {
  apiKey: string;
  apiSecret: string;
};

const DEFAULT_SYMBOLS = ["BTCEUR", "ETHEUR", "BTCUSDT", "ETHUSDT", "BNBEUR", "SOLUSDT"];

function signBinance(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function binanceGet(
  client: HttpClient,
  creds: BinanceCredentials,
  path: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const timestamp = Date.now();
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(timestamp),
  });
  const signature = signBinance(qs.toString(), creds.apiSecret);
  qs.set("signature", signature);
  return client.json(`${BINANCE_API}${path}?${qs}`, {
    method: "GET",
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
}

function inTaxYear(iso: string, tax_year: number): boolean {
  return iso.startsWith(String(tax_year));
}

function quoteToEur(quoteAsset: string, quoteQty: number): number | null {
  if (quoteAsset === "EUR") return quoteQty;
  if (quoteAsset === "USDT" || quoteAsset === "USDC" || quoteAsset === "BUSD") {
    return quoteQty; // v1: treat stablecoins ≈ EUR
  }
  return null;
}

export function parseBinanceTrade(
  row: {
    id: number;
    time: number;
    symbol: string;
    isBuyer: boolean;
    qty: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
  },
  tax_year: number
): CryptoTransaction | null {
  const occurred_at = new Date(row.time).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;

  const symbol = row.symbol;
  let asset = symbol;
  let quote = "EUR";
  for (const q of ["EUR", "USDT", "USDC", "BUSD", "BTC", "ETH"]) {
    if (symbol.endsWith(q)) {
      asset = symbol.slice(0, -q.length);
      quote = q;
      break;
    }
  }

  const qty = parseFloat(row.qty) * (row.isBuyer ? 1 : -1);
  const quoteQty = parseFloat(row.quoteQty);
  const fiat = quoteToEur(quote, quoteQty);

  return {
    id: `binance-trade-${row.id}`,
    occurred_at,
    asset,
    quantity: qty,
    fiat_amount_eur: fiat,
    fee_eur: row.commissionAsset === "EUR" ? parseFloat(row.commission) : null,
    tx_type: row.isBuyer ? "buy" : "sell",
    needs_clarification: fiat == null,
    source_type: "exchange",
    external_id: String(row.id),
  };
}

export function parseBinanceDeposit(
  row: { id: string; amount: string; coin: string; insertTime: number; status: number },
  tax_year: number
): CryptoTransaction | null {
  if (row.status !== 1) return null;
  const occurred_at = new Date(row.insertTime).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;
  const qty = parseFloat(row.amount);
  return {
    id: `binance-deposit-${row.id}`,
    occurred_at,
    asset: row.coin,
    quantity: qty,
    fiat_amount_eur: null,
    fee_eur: null,
    tx_type: "transfer_in",
    needs_clarification: true,
    source_type: "exchange",
    external_id: row.id,
  };
}

export function parseBinanceWithdrawal(
  row: {
    id: string;
    amount: string;
    coin: string;
    applyTime: string;
    transactionFee: string;
    status: number;
  },
  tax_year: number
): CryptoTransaction | null {
  if (row.status !== 6) return null;
  const occurred_at = new Date(row.applyTime).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;
  const qty = -Math.abs(parseFloat(row.amount));
  const fee = parseFloat(row.transactionFee) || 0;
  return {
    id: `binance-withdraw-${row.id}`,
    occurred_at,
    asset: row.coin,
    quantity: qty,
    fiat_amount_eur: null,
    fee_eur: fee > 0 ? fee : null,
    tx_type: "transfer_out",
    needs_clarification: true,
    source_type: "exchange",
    external_id: row.id,
  };
}

export async function syncBinanceTrades(
  creds: BinanceCredentials,
  tax_year: number,
  fetchFn?: FetchFn,
  symbols = DEFAULT_SYMBOLS
): Promise<CryptoTransaction[]> {
  const client = new HttpClient({ fetchFn, minIntervalMs: 250 });
  const txs: CryptoTransaction[] = [];

  for (const symbol of symbols) {
    try {
      const trades = (await binanceGet(client, creds, "/api/v3/myTrades", {
        symbol,
        limit: 1000,
      })) as Parameters<typeof parseBinanceTrade>[0][];
      if (Array.isArray(trades)) {
        for (const tr of trades) {
          const tx = parseBinanceTrade(tr, tax_year);
          if (tx) txs.push(tx);
        }
      }
    } catch {
      // symbol may not exist on account — skip
    }
  }
  return txs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export async function syncBinanceDepositsWithdrawals(
  creds: BinanceCredentials,
  tax_year: number,
  fetchFn?: FetchFn
): Promise<CryptoTransaction[]> {
  const client = new HttpClient({ fetchFn, minIntervalMs: 250 });
  const txs: CryptoTransaction[] = [];

  const deposits = (await binanceGet(client, creds, "/sapi/v1/capital/deposit/hisrec", {
    limit: 1000,
  })) as Parameters<typeof parseBinanceDeposit>[0][];
  if (Array.isArray(deposits)) {
    for (const d of deposits) {
      const tx = parseBinanceDeposit(d, tax_year);
      if (tx) txs.push(tx);
    }
  }

  const withdrawals = (await binanceGet(client, creds, "/sapi/v1/capital/withdraw/history", {
    limit: 1000,
  })) as Parameters<typeof parseBinanceWithdrawal>[0][];
  if (Array.isArray(withdrawals)) {
    for (const w of withdrawals) {
      const tx = parseBinanceWithdrawal(w, tax_year);
      if (tx) txs.push(tx);
    }
  }
  return txs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export async function fetchBinanceTransactions(
  creds: BinanceCredentials,
  tax_year: number,
  fetchFn?: FetchFn,
  symbols = DEFAULT_SYMBOLS
): Promise<CryptoTransaction[]> {
  const [trades, flows] = await Promise.all([
    syncBinanceTrades(creds, tax_year, fetchFn, symbols),
    syncBinanceDepositsWithdrawals(creds, tax_year, fetchFn),
  ]);
  return [...trades, ...flows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function binanceCredentialsFromEnv(): BinanceCredentials | null {
  const apiKey = process.env.BINANCE_API_KEY?.trim();
  const apiSecret = process.env.BINANCE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function makeBinanceTx(overrides: Partial<CryptoTransaction> = {}): CryptoTransaction {
  return {
    id: randomUUID(),
    occurred_at: "2024-06-15T14:32:00Z",
    asset: "BTC",
    quantity: 0.01,
    fiat_amount_eur: 450,
    fee_eur: null,
    tx_type: "buy",
    needs_clarification: false,
    source_type: "exchange",
    ...overrides,
  };
}
