import type { FetchFn } from "./http-client.js";
import {
  defaultMarketDb,
  toMinuteTs,
  type MarketDb,
  type MarketMinuteRow,
  type MarketPriceSource,
} from "./market-db.js";

const BINANCE_PUBLIC = process.env.BINANCE_PUBLIC_API_URL?.trim() || "https://api.binance.com";
const COINGECKO_API = process.env.COINGECKO_API_URL?.trim() || "https://api.coingecko.com";

/** Binance EUR spot pairs for backfill / fallback. */
const ASSET_BINANCE_SYMBOL: Record<string, string> = {
  BTC: "BTCEUR",
  ETH: "ETHEUR",
  BNB: "BNBEUR",
  SOL: "SOLEUR",
  XRP: "XRPEUR",
  ADA: "ADAEUR",
  DOGE: "DOGEEUR",
  DOT: "DOTEUR",
  MATIC: "MATICEUR",
  LINK: "LINKEUR",
};

const ASSET_COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
};

export type PriceResolverOptions = {
  marketDb?: MarketDb;
  fetchFn?: FetchFn;
};

export class PriceResolver {
  private readonly db: MarketDb;
  private readonly fetchFn: FetchFn;

  constructor(opts: PriceResolverOptions = {}) {
    this.db = opts.marketDb ?? defaultMarketDb;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  get marketDb(): MarketDb {
    return this.db;
  }

  /** DB first; API fallback only when the minute row is missing. */
  async resolveEur(asset: string, occurred_at: string): Promise<number | null> {
    const minute_ts = toMinuteTs(occurred_at);
    const cached = this.db.getPrice(asset, minute_ts);
    if (cached) return cached.price_eur;

    const fromApi = await fetchMinutePriceEur(asset, minute_ts, this.fetchFn);
    if (fromApi) {
      this.db.upsert({ asset, minute_ts, price_eur: fromApi.price, source: fromApi.source });
      return fromApi.price;
    }
    return null;
  }

  /** Batch backfill: skip rows already in DB; fetch and persist gaps. */
  async backfillRange(
    asset: string,
    from: string,
    to: string,
    source: "binance_public" | "coingecko" = "binance_public"
  ): Promise<MarketMinuteRow[]> {
    const minute_ts = toMinuteTs(from);
    const end_ts = toMinuteTs(to);
    const existing = new Set(this.db.listRange(asset, minute_ts, end_ts).map((r) => r.minute_ts));
    const fetched =
      source === "coingecko"
        ? await fetchCoingeckoRange(asset, minute_ts, end_ts, this.fetchFn)
        : await fetchBinanceKlines(asset, minute_ts, end_ts, this.fetchFn);

    const toInsert = fetched.filter((r) => !existing.has(r.minute_ts));
    return this.db.upsertMany(toInsert);
  }
}

export async function fetchBinanceKlines(
  asset: string,
  from: string,
  to: string,
  fetchFn: FetchFn = globalThis.fetch
): Promise<MarketMinuteRow[]> {
  const symbol = ASSET_BINANCE_SYMBOL[asset.toUpperCase()];
  if (!symbol) return [];

  const rows: MarketMinuteRow[] = [];
  let start = Date.parse(toMinuteTs(from));
  const end = Date.parse(toMinuteTs(to));

  while (start <= end) {
    const url = new URL(`${BINANCE_PUBLIC}/api/v3/klines`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1m");
    url.searchParams.set("startTime", String(start));
    url.searchParams.set("endTime", String(end));
    url.searchParams.set("limit", "1000");

    const res = await fetchFn(url);
    if (!res.ok) break;
    const klines = (await res.json()) as unknown[][];
    if (!klines.length) break;

    for (const k of klines) {
      const openTime = Number(k[0]);
      const close = parseFloat(String(k[4]));
      if (!Number.isFinite(close) || close <= 0) continue;
      rows.push({
        asset: asset.toUpperCase(),
        minute_ts: new Date(openTime).toISOString(),
        price_eur: close,
        source: "binance_public",
      });
    }

    const lastOpen = Number(klines[klines.length - 1]![0]);
    start = lastOpen + 60_000;
    if (klines.length < 1000) break;
  }

  return rows;
}

export async function fetchCoingeckoMinute(
  asset: string,
  minute_ts: string,
  fetchFn: FetchFn = globalThis.fetch
): Promise<number | null> {
  const id = ASSET_COINGECKO_ID[asset.toUpperCase()];
  if (!id) return null;

  const ts = Math.floor(Date.parse(toMinuteTs(minute_ts)) / 1000);
  const from = ts - 60;
  const to = ts + 60;
  const url = `${COINGECKO_API}/api/v3/coins/${id}/market_chart/range?vs_currency=eur&from=${from}&to=${to}`;
  const res = await fetchFn(url);
  if (!res.ok) return null;

  const body = (await res.json()) as { prices?: [number, number][] };
  const prices = body.prices ?? [];
  if (!prices.length) return null;

  const target = Date.parse(toMinuteTs(minute_ts));
  let best: [number, number] | null = null;
  let bestDelta = Infinity;
  for (const p of prices) {
    const delta = Math.abs(p[0] - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return best ? best[1] : null;
}

async function fetchCoingeckoRange(
  asset: string,
  from: string,
  to: string,
  fetchFn: FetchFn
): Promise<MarketMinuteRow[]> {
  const id = ASSET_COINGECKO_ID[asset.toUpperCase()];
  if (!id) return [];

  const fromSec = Math.floor(Date.parse(toMinuteTs(from)) / 1000);
  const toSec = Math.floor(Date.parse(toMinuteTs(to)) / 1000);
  const url = `${COINGECKO_API}/api/v3/coins/${id}/market_chart/range?vs_currency=eur&from=${fromSec}&to=${toSec}`;
  const res = await fetchFn(url);
  if (!res.ok) return [];

  const body = (await res.json()) as { prices?: [number, number][] };
  const byMinute = new Map<string, number>();
  for (const [ms, price] of body.prices ?? []) {
    const minute = toMinuteTs(new Date(ms).toISOString());
    byMinute.set(minute, price);
  }

  return [...byMinute.entries()].map(([minute_ts, price_eur]) => ({
    asset: asset.toUpperCase(),
    minute_ts,
    price_eur,
    source: "coingecko" as MarketPriceSource,
  }));
}

async function fetchMinutePriceEur(
  asset: string,
  minute_ts: string,
  fetchFn: FetchFn
): Promise<{ price: number; source: MarketPriceSource } | null> {
  const binanceRows = await fetchBinanceKlines(asset, minute_ts, minute_ts, fetchFn);
  if (binanceRows[0]) {
    return { price: binanceRows[0].price_eur, source: "binance_public" };
  }

  const cg = await fetchCoingeckoMinute(asset, minute_ts, fetchFn);
  if (cg != null) return { price: cg, source: "coingecko" };

  return null;
}
