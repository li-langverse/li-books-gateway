#!/usr/bin/env node
/** CLI: backfill shared `crypto_market_minute` from Binance public klines or CoinGecko. */
import { InMemoryMarketDb } from "./market-db.js";
import { PriceResolver } from "./price-resolver.js";

export type BackfillArgs = {
  from: string;
  to: string;
  assets: string[];
  source?: "binance_public" | "coingecko";
};

export function parseBackfillArgv(argv: string[]): BackfillArgs {
  let from = "";
  let to = "";
  let assets: string[] = [];
  let source: BackfillArgs["source"] = "binance_public";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--from") from = argv[++i] ?? "";
    else if (arg === "--to") to = argv[++i] ?? "";
    else if (arg === "--assets") assets = (argv[++i] ?? "").split(",").map((a) => a.trim()).filter(Boolean);
    else if (arg === "--source") source = (argv[++i] as BackfillArgs["source"]) ?? "binance_public";
  }

  if (!from || !to || !assets.length) {
    throw new Error(
      "usage: crypto-market-backfill --from ISO_DATE --to ISO_DATE --assets BTC,ETH [--source binance_public|coingecko]"
    );
  }
  return { from, to, assets, source };
}

export async function runMarketBackfill(
  args: BackfillArgs,
  marketDb = new InMemoryMarketDb(),
  fetchFn: typeof fetch = globalThis.fetch
): Promise<{ asset: string; inserted: number }[]> {
  const resolver = new PriceResolver({ marketDb, fetchFn });
  const results: { asset: string; inserted: number }[] = [];

  for (const asset of args.assets) {
    const before = marketDb.count();
    await resolver.backfillRange(asset, args.from, args.to, args.source ?? "binance_public");
    const after = marketDb.count();
    results.push({ asset: asset.toUpperCase(), inserted: after - before });
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseBackfillArgv(process.argv.slice(2));
  const results = await runMarketBackfill(args);
  for (const r of results) {
    console.log(`${r.asset}: inserted ${r.inserted} minute rows`);
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("market-backfill.js") ||
    process.argv[1].endsWith("market-backfill.ts"));

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
