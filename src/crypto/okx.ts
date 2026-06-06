import { createHmac, randomUUID } from "node:crypto";
import type { CryptoTransaction } from "./types.js";
import { HttpClient, type FetchFn } from "./http-client.js";

const OKX_API = process.env.OKX_API_URL?.trim() || "https://www.okx.com";

export type OkxCredentials = {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
};

type OkxResponse<T> = { code: string; msg: string; data: T };

function signOkx(timestamp: string, method: string, path: string, body: string, secret: string): string {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return createHmac("sha256", secret).update(prehash).digest("base64");
}

function okxGet(
  client: HttpClient,
  creds: OkxCredentials,
  path: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const requestPath = qs.size ? `${path}?${qs}` : path;
  const timestamp = new Date().toISOString();
  const signature = signOkx(timestamp, "GET", requestPath, "", creds.apiSecret);
  return client.json(`${OKX_API}${requestPath}`, {
    method: "GET",
    headers: {
      "OK-ACCESS-KEY": creds.apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": creds.passphrase,
      "Content-Type": "application/json",
    },
  });
}

function inTaxYear(iso: string, tax_year: number): boolean {
  return iso.startsWith(String(tax_year));
}

function instIdToAsset(instId: string): string {
  const [base] = instId.split("-");
  return base ?? instId;
}

export function parseOkxFill(
  row: {
    fillId: string;
    instId: string;
    side: string;
    fillSz: string;
    fillPx: string;
    fee: string;
    feeCcy: string;
    ts: string;
  },
  tax_year: number
): CryptoTransaction | null {
  const occurred_at = new Date(parseInt(row.ts, 10)).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;

  const asset = instIdToAsset(row.instId);
  const sz = parseFloat(row.fillSz);
  const px = parseFloat(row.fillPx);
  const isBuy = row.side.toLowerCase() === "buy";
  const qty = sz * (isBuy ? 1 : -1);
  const quote = row.instId.split("-")[1] ?? "EUR";
  const fiat =
    quote === "EUR" ? sz * px : quote === "USDT" || quote === "USDC" ? sz * px : null;

  return {
    id: `okx-fill-${row.fillId}`,
    occurred_at,
    asset,
    quantity: qty,
    fiat_amount_eur: fiat,
    fee_eur: row.feeCcy === "EUR" ? Math.abs(parseFloat(row.fee)) : null,
    tx_type: isBuy ? "buy" : "sell",
    needs_clarification: fiat == null,
    source_type: "exchange",
    external_id: row.fillId,
  };
}

export function parseOkxDeposit(
  row: { depId: string; ccy: string; amt: string; ts: string; state: string },
  tax_year: number
): CryptoTransaction | null {
  if (row.state !== "2") return null;
  const occurred_at = new Date(parseInt(row.ts, 10)).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;
  return {
    id: `okx-deposit-${row.depId}`,
    occurred_at,
    asset: row.ccy,
    quantity: parseFloat(row.amt),
    fiat_amount_eur: null,
    fee_eur: null,
    tx_type: "transfer_in",
    needs_clarification: true,
    source_type: "exchange",
    external_id: row.depId,
  };
}

export function parseOkxWithdrawal(
  row: { wdId: string; ccy: string; amt: string; ts: string; state: string; fee: string },
  tax_year: number
): CryptoTransaction | null {
  if (row.state !== "2") return null;
  const occurred_at = new Date(parseInt(row.ts, 10)).toISOString();
  if (!inTaxYear(occurred_at, tax_year)) return null;
  const fee = parseFloat(row.fee) || 0;
  return {
    id: `okx-withdraw-${row.wdId}`,
    occurred_at,
    asset: row.ccy,
    quantity: -Math.abs(parseFloat(row.amt)),
    fiat_amount_eur: null,
    fee_eur: fee > 0 ? fee : null,
    tx_type: "transfer_out",
    needs_clarification: true,
    source_type: "exchange",
    external_id: row.wdId,
  };
}

export async function syncOkxTrades(
  creds: OkxCredentials,
  tax_year: number,
  fetchFn?: FetchFn
): Promise<CryptoTransaction[]> {
  const client = new HttpClient({ fetchFn, minIntervalMs: 300 });
  const txs: CryptoTransaction[] = [];

  const fillsRes = (await okxGet(client, creds, "/api/v5/trade/fills-history", {
    instType: "SPOT",
    limit: "100",
  })) as OkxResponse<Parameters<typeof parseOkxFill>[0][]>;
  if (fillsRes.code !== "0") {
    throw new Error(`OKX API: ${fillsRes.msg}`);
  }
  for (const row of fillsRes.data ?? []) {
    const tx = parseOkxFill(row, tax_year);
    if (tx) txs.push(tx);
  }
  return txs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export async function syncOkxDepositsWithdrawals(
  creds: OkxCredentials,
  tax_year: number,
  fetchFn?: FetchFn
): Promise<CryptoTransaction[]> {
  const client = new HttpClient({ fetchFn, minIntervalMs: 300 });
  const txs: CryptoTransaction[] = [];

  const depRes = (await okxGet(client, creds, "/api/v5/asset/deposit-history", {
    limit: "100",
  })) as OkxResponse<Parameters<typeof parseOkxDeposit>[0][]>;
  if (depRes.code !== "0") {
    throw new Error(`OKX API deposits: ${depRes.msg}`);
  }
  for (const row of depRes.data ?? []) {
    const tx = parseOkxDeposit(row, tax_year);
    if (tx) txs.push(tx);
  }

  const wdRes = (await okxGet(client, creds, "/api/v5/asset/withdrawal-history", {
    limit: "100",
  })) as OkxResponse<Parameters<typeof parseOkxWithdrawal>[0][]>;
  if (wdRes.code !== "0") {
    throw new Error(`OKX API withdrawals: ${wdRes.msg}`);
  }
  for (const row of wdRes.data ?? []) {
    const tx = parseOkxWithdrawal(row, tax_year);
    if (tx) txs.push(tx);
  }
  return txs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export async function fetchOkxTransactions(
  creds: OkxCredentials,
  tax_year: number,
  fetchFn?: FetchFn
): Promise<CryptoTransaction[]> {
  const [trades, flows] = await Promise.all([
    syncOkxTrades(creds, tax_year, fetchFn),
    syncOkxDepositsWithdrawals(creds, tax_year, fetchFn),
  ]);
  return [...trades, ...flows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function okxCredentialsFromEnv(): OkxCredentials | null {
  const apiKey = process.env.OKX_API_KEY?.trim();
  const apiSecret = process.env.OKX_API_SECRET?.trim();
  const passphrase = process.env.OKX_PASSPHRASE?.trim();
  if (!apiKey || !apiSecret || !passphrase) return null;
  return { apiKey, apiSecret, passphrase };
}

export function makeOkxTx(overrides: Partial<CryptoTransaction> = {}): CryptoTransaction {
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
