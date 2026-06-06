/** Platform-owned minute EUR prices — mirrors lidb `crypto_market_minute` (no user_id). */

export type MarketPriceSource = "coingecko" | "binance_public" | "manual" | "other";

export type MarketMinuteRow = {
  asset: string;
  minute_ts: string;
  price_eur: number;
  source: MarketPriceSource;
};

export function toMinuteTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid_iso_timestamp: ${iso}`);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export function marketKey(asset: string, minute_ts: string): string {
  return `${asset.toUpperCase()}:${toMinuteTs(minute_ts)}`;
}

export interface MarketDb {
  getPrice(asset: string, minute_ts: string): MarketMinuteRow | null;
  upsert(row: MarketMinuteRow): MarketMinuteRow;
  upsertMany(rows: MarketMinuteRow[]): MarketMinuteRow[];
  listRange(asset: string, from: string, to: string): MarketMinuteRow[];
  count(): number;
}

/** In-memory stand-in for dev/tests; production uses lidb `crypto_market_minute`. */
export class InMemoryMarketDb implements MarketDb {
  private readonly rows = new Map<string, MarketMinuteRow>();

  getPrice(asset: string, minute_ts: string): MarketMinuteRow | null {
    return this.rows.get(marketKey(asset, minute_ts)) ?? null;
  }

  upsert(row: MarketMinuteRow): MarketMinuteRow {
    const normalized: MarketMinuteRow = {
      asset: row.asset.toUpperCase(),
      minute_ts: toMinuteTs(row.minute_ts),
      price_eur: row.price_eur,
      source: row.source,
    };
    this.rows.set(marketKey(normalized.asset, normalized.minute_ts), normalized);
    return normalized;
  }

  upsertMany(rows: MarketMinuteRow[]): MarketMinuteRow[] {
    return rows.map((r) => this.upsert(r));
  }

  listRange(asset: string, from: string, to: string): MarketMinuteRow[] {
    const assetUp = asset.toUpperCase();
    const fromMs = Date.parse(toMinuteTs(from));
    const toMs = Date.parse(toMinuteTs(to));
    return [...this.rows.values()]
      .filter((r) => {
        if (r.asset !== assetUp) return false;
        const ms = Date.parse(r.minute_ts);
        return ms >= fromMs && ms <= toMs;
      })
      .sort((a, b) => a.minute_ts.localeCompare(b.minute_ts));
  }

  count(): number {
    return this.rows.size;
  }
}

export const defaultMarketDb = new InMemoryMarketDb();
