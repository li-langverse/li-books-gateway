import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMarketDb } from "./market-db.js";
import { PriceResolver } from "./price-resolver.js";
import { applyFifo } from "./fifo-engine.js";
import { buildMinuteTimeline } from "./tax-engine.js";
import { CryptoStore } from "./store.js";
import { InMemorySyncStore } from "./sync-store.js";
import { syncCrypto } from "./connectors.js";
import type { CryptoTransaction } from "./types.js";

const SHARED_MINUTE = "2024-06-15T14:32:00.000Z";
const BTC_PRICE = 45_000;

function mockBinanceKlineFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/api/v3/klines")) {
      return new Response(
        JSON.stringify([[Date.parse(SHARED_MINUTE), "1", "2", "2", String(BTC_PRICE), "0"]]),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 404 });
  };
}

describe("shared crypto_market_minute", () => {
  it("dedupes price across two users — single DB row", async () => {
    const db = new InMemoryMarketDb();
    const fetchFn = mockBinanceKlineFetch();
    const resolverA = new PriceResolver({ marketDb: db, fetchFn });
    const resolverB = new PriceResolver({ marketDb: db, fetchFn });

    const priceA = await resolverA.resolveEur("BTC", SHARED_MINUTE);
    const priceB = await resolverB.resolveEur("BTC", SHARED_MINUTE);

    assert.equal(priceA, BTC_PRICE);
    assert.equal(priceB, BTC_PRICE);
    assert.equal(db.count(), 1);
    assert.equal(db.getPrice("BTC", SHARED_MINUTE)?.source, "binance_public");
  });

  it("FIFO uses shared minute price when fiat_amount_eur is missing", async () => {
    const db = new InMemoryMarketDb();
    db.upsert({
      asset: "BTC",
      minute_ts: SHARED_MINUTE,
      price_eur: BTC_PRICE,
      source: "manual",
    });

    const resolver = new PriceResolver({ marketDb: db });
    const txs: CryptoTransaction[] = [
      {
        id: "buy-1",
        occurred_at: "2024-06-15T14:00:00Z",
        asset: "BTC",
        quantity: 0.1,
        fiat_amount_eur: 4_000,
        tx_type: "buy",
        needs_clarification: false,
        source_type: "exchange",
      },
      {
        id: "sell-1",
        occurred_at: SHARED_MINUTE,
        asset: "BTC",
        quantity: -0.05,
        fiat_amount_eur: null,
        tx_type: "sell",
        needs_clarification: true,
        source_type: "exchange",
      },
    ];

    const fifo = await applyFifo(txs, resolver);
    const sell = fifo.tx_results.find((r) => r.tx.id === "sell-1");
    assert.ok(sell);
    assert.equal(sell!.resolved_fiat_eur, 2_250);
    assert.equal(sell!.realized_pnl_eur, 250);
    assert.equal(db.count(), 1);

    const timeline = buildMinuteTimeline(txs, 2024, "freelance", fifo.tx_results);
    const sellMinute = timeline.find((m) => m.minute_ts.startsWith("2024-06-15T14:32"));
    assert.ok(sellMinute);
    assert.ok(sellMinute!.realized_pnl_eur >= 250);
  });

  it("keeps user transactions isolated in separate book stores", async () => {
    const storeA = new CryptoStore();
    const storeB = new CryptoStore();
    const syncA = new InMemorySyncStore();
    const syncB = new InMemorySyncStore();

    const csvA = `time,type,asset,amount,eur
2024-06-15T14:32:00Z,sell,BTC,-0.01,450.00`;
    const csvB = `time,type,asset,amount,eur
2024-06-15T15:00:00Z,buy,ETH,0.5,1500.00`;

    const resultA = await syncCrypto(
      { book_id: "book-user-a", tax_year: 2024, sources: ["csv"], csv: csvA, user_id: "user-a" },
      storeA,
      undefined,
      undefined,
      syncA
    );
    const resultB = await syncCrypto(
      { book_id: "book-user-b", tax_year: 2024, sources: ["csv"], csv: csvB, user_id: "user-b" },
      storeB,
      undefined,
      undefined,
      syncB
    );

    assert.equal(resultA.imported, 1);
    assert.equal(resultB.imported, 1);
    assert.equal(storeA.listByBookYear("book-user-a", 2024).length, 1);
    assert.equal(storeB.listByBookYear("book-user-b", 2024).length, 1);
    assert.equal(storeA.listByBookYear("book-user-b", 2024).length, 0);
    assert.equal(storeB.listByBookYear("book-user-a", 2024).length, 0);

    assert.equal(syncA.listRaw("book-user-a", "user-a").length, 1);
    assert.equal(syncB.listRaw("book-user-b", "user-b").length, 1);
    assert.equal(syncA.listRaw("book-user-b", "user-b").length, 0);
  });
});

describe("crypto-market-backfill CLI", () => {
  it("parses --from --to --assets and inserts via mocked klines", async () => {
    const { parseBackfillArgv, runMarketBackfill } = await import("./market-backfill.js");
    const args = parseBackfillArgv([
      "--from",
      "2024-06-15T14:32:00Z",
      "--to",
      "2024-06-15T14:32:00Z",
      "--assets",
      "BTC",
    ]);
    assert.equal(args.assets[0], "BTC");

    const db = new InMemoryMarketDb();
    const results = await runMarketBackfill(args, db, mockBinanceKlineFetch());
    assert.equal(results[0]!.inserted, 1);
    assert.equal(db.getPrice("BTC", SHARED_MINUTE)?.price_eur, BTC_PRICE);
  });
});
