import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExchangeCsv, syncCrypto } from "./connectors.js";
import { buildMinuteTimeline } from "./tax-engine.js";
import { CryptoStore } from "./store.js";
import { CryptoAdapterRegistry } from "./adapters/registry.js";
import { binanceAdapter } from "./adapters/binance.adapter.js";
import { okxAdapter } from "./adapters/okx.adapter.js";
import { parseBinanceTrade, parseBinanceDeposit, fetchBinanceTransactions } from "./binance.js";
import { parseOkxFill, fetchOkxTransactions } from "./okx.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dir, "..", "..", "tests", "fixtures", "crypto");

const FIXTURE_CSV = `time,type,asset,amount,eur
2024-06-15T14:32:00Z,sell,BTC,-0.01,450.00
2024-06-15T14:32:00Z,fee,BTC,-0.0001,2.50
2024-06-15T15:00:00Z,staking_reward,ETH,0.05,120.00`;

describe("adapter registry", () => {
  it("lists MVP sources binance and okx as enabled", () => {
    const registry = new CryptoAdapterRegistry();
    const enabled = registry.enabledSourceIds();
    assert.ok(enabled.includes("binance"));
    assert.ok(enabled.includes("okx"));
    assert.ok(enabled.includes("csv"));
    assert.ok(enabled.includes("eth_wallet"));
    assert.ok(!enabled.includes("kraken"));
  });

  it("registers future stubs as unavailable", () => {
    const registry = new CryptoAdapterRegistry();
    const v = registry.validateSources(["kraken", "coinbase", "bybit"]);
    assert.deepEqual(v.valid, []);
    assert.deepEqual(v.unavailable.sort(), ["bybit", "coinbase", "kraken"]);
  });

  it("rejects unknown sources", () => {
    const registry = new CryptoAdapterRegistry();
    const v = registry.validateSources(["unknown_exchange"]);
    assert.deepEqual(v.invalid, ["unknown_exchange"]);
  });
});

describe("crypto connectors", () => {
  it("parses exchange CSV into transactions", () => {
    const txs = parseExchangeCsv(FIXTURE_CSV, 2024);
    assert.equal(txs.length, 3);
    assert.equal(txs[0]!.tx_type, "sell");
  });

  it("returns invalid sources without syncing", async () => {
    const store = new CryptoStore();
    const result = await syncCrypto(
      { book_id: "book-1", tax_year: 2024, sources: ["not_real"] },
      store
    );
    assert.equal(result.imported, 0);
    assert.deepEqual(result.invalid, ["not_real"]);
  });

  it("reports unavailable for planned exchange stubs", async () => {
    const store = new CryptoStore();
    const result = await syncCrypto(
      { book_id: "book-1", tax_year: 2024, sources: ["kraken"] },
      store
    );
    assert.equal(result.imported, 0);
    assert.deepEqual(result.unavailable, ["kraken"]);
  });
});

describe("binance adapter", () => {
  it("parses trade and deposit rows", () => {
    const trade = parseBinanceTrade(
      {
        id: 1,
        time: Date.parse("2024-06-15T14:32:00Z"),
        symbol: "BTCEUR",
        isBuyer: false,
        qty: "0.01",
        quoteQty: "450",
        commission: "0.5",
        commissionAsset: "EUR",
      },
      2024
    );
    assert.ok(trade);
    assert.equal(trade!.tx_type, "sell");

    const dep = parseBinanceDeposit(
      { id: "d1", amount: "0.5", coin: "ETH", insertTime: Date.parse("2024-03-01T10:00:00Z"), status: 1 },
      2024
    );
    assert.equal(dep!.tx_type, "transfer_in");
  });

  it("syncTrades via mocked HTTP", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("myTrades") && url.includes("symbol=BTCEUR")) {
        return new Response(
          JSON.stringify([
            {
              id: 99,
              time: Date.parse("2024-06-15T14:32:00Z"),
              symbol: "BTCEUR",
              isBuyer: true,
              qty: "0.02",
              quoteQty: "900",
              commission: "0.1",
              commissionAsset: "EUR",
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("myTrades")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const ctx = { book_id: "b", tax_year: 2024, fetchFn: mockFetch };
    const prevKey = process.env.BINANCE_API_KEY;
    const prevSecret = process.env.BINANCE_API_SECRET;
    process.env.BINANCE_API_KEY = "k";
    process.env.BINANCE_API_SECRET = "s";
    try {
      const trades = await binanceAdapter.syncTrades(ctx);
      assert.equal(trades.length, 1);
      assert.equal(trades[0]!.tx_type, "buy");
      const raw = {
        id: 99,
        time: Date.parse("2024-06-15T14:32:00Z"),
        symbol: "BTCEUR",
        isBuyer: true,
        qty: "0.02",
        quoteQty: "900",
        commission: "0.1",
        commissionAsset: "EUR",
      };
      assert.equal(binanceAdapter.normalizeTx(raw, 2024)?.tx_type, "buy");
    } finally {
      if (prevKey === undefined) delete process.env.BINANCE_API_KEY;
      else process.env.BINANCE_API_KEY = prevKey;
      if (prevSecret === undefined) delete process.env.BINANCE_API_SECRET;
      else process.env.BINANCE_API_SECRET = prevSecret;
    }
  });
});

describe("okx adapter", () => {
  it("parses fill rows", () => {
    const fill = parseOkxFill(
      {
        fillId: "f1",
        instId: "BTC-EUR",
        side: "buy",
        fillSz: "0.01",
        fillPx: "45000",
        fee: "0.5",
        feeCcy: "EUR",
        ts: String(Date.parse("2024-06-15T14:32:00Z")),
      },
      2024
    );
    assert.ok(fill);
    assert.equal(fill!.asset, "BTC");
  });

  it("fetches via mocked HTTP", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("fills-history")) {
        return new Response(
          JSON.stringify({
            code: "0",
            msg: "",
            data: [
              {
                fillId: "okx-1",
                instId: "ETH-EUR",
                side: "sell",
                fillSz: "0.5",
                fillPx: "3000",
                fee: "1",
                feeCcy: "EUR",
                ts: String(Date.parse("2024-06-15T15:00:00Z")),
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ code: "0", msg: "", data: [] }), { status: 200 });
    };

    const txs = await fetchOkxTransactions(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      2024,
      mockFetch
    );
    assert.equal(txs.length, 1);
    assert.equal(txs[0]!.tx_type, "sell");
    const raw = {
      fillId: "okx-1",
      instId: "ETH-EUR",
      side: "sell",
      fillSz: "0.5",
      fillPx: "3000",
      fee: "1",
      feeCcy: "EUR",
      ts: String(Date.parse("2024-06-15T15:00:00Z")),
    };
    assert.equal(okxAdapter.normalizeTx(raw, 2024)?.tx_type, "sell");
  });
});

describe("crypto sync integration", () => {
  it("syncs binance + okx from mocked HTTP into store", async () => {
    const store = new CryptoStore();
    const prevBinanceKey = process.env.BINANCE_API_KEY;
    const prevBinanceSecret = process.env.BINANCE_API_SECRET;
    const prevOkxKey = process.env.OKX_API_KEY;
    const prevOkxSecret = process.env.OKX_API_SECRET;
    const prevOkxPass = process.env.OKX_PASSPHRASE;
    process.env.BINANCE_API_KEY = "test";
    process.env.BINANCE_API_SECRET = "test";
    process.env.OKX_API_KEY = "test";
    process.env.OKX_API_SECRET = "test";
    process.env.OKX_PASSPHRASE = "test";

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("binance.com")) {
        if (url.includes("myTrades") && url.includes("symbol=BTCEUR")) {
          return new Response(
            JSON.stringify([
              {
                id: 1,
                time: Date.parse("2024-01-10T10:00:00Z"),
                symbol: "BTCEUR",
                isBuyer: true,
                qty: "0.1",
                quoteQty: "4000",
                commission: "0",
                commissionAsset: "EUR",
              },
            ]),
            { status: 200 }
          );
        }
        if (url.includes("myTrades")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("okx.com")) {
        if (url.includes("fills-history")) {
          return new Response(
            JSON.stringify({
              code: "0",
              msg: "",
              data: [
                {
                  fillId: "x1",
                  instId: "BTC-EUR",
                  side: "sell",
                  fillSz: "0.05",
                  fillPx: "45000",
                  fee: "0",
                  feeCcy: "EUR",
                  ts: String(Date.parse("2024-06-01T12:00:00Z")),
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ code: "0", msg: "", data: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };

    try {
      const result = await syncCrypto(
        { book_id: "book-sync", tax_year: 2024, sources: ["binance", "okx"] },
        store,
        undefined,
        mockFetch
      );
      assert.equal(result.imported, 2);
      assert.deepEqual(result.sources.sort(), ["binance", "okx"]);
      const stored = store.listByBookYear("book-sync", 2024);
      assert.equal(stored.length, 2);
      const timeline = buildMinuteTimeline(stored, 2024, "freelance");
      assert.ok(timeline.length >= 2);
    } finally {
      if (prevBinanceKey === undefined) delete process.env.BINANCE_API_KEY;
      else process.env.BINANCE_API_KEY = prevBinanceKey;
      if (prevBinanceSecret === undefined) delete process.env.BINANCE_API_SECRET;
      else process.env.BINANCE_API_SECRET = prevBinanceSecret;
      if (prevOkxKey === undefined) delete process.env.OKX_API_KEY;
      else process.env.OKX_API_KEY = prevOkxKey;
      if (prevOkxSecret === undefined) delete process.env.OKX_API_SECRET;
      else process.env.OKX_API_SECRET = prevOkxSecret;
      if (prevOkxPass === undefined) delete process.env.OKX_PASSPHRASE;
      else process.env.OKX_PASSPHRASE = prevOkxPass;
    }
  });
});

describe("crypto tax minute timeline", () => {
  it("matches golden timeline from fixture CSV", () => {
    const txs = parseExchangeCsv(FIXTURE_CSV, 2024);
    const timeline = buildMinuteTimeline(txs, 2024, "freelance");
    const json = JSON.stringify(timeline, null, 2);
    if (!existsSync(FIX)) mkdirSync(FIX, { recursive: true });
    const golden = join(FIX, "timeline-2024.json");
    if (!existsSync(golden)) writeFileSync(golden, json);
    assert.equal(json, readFileSync(golden, "utf8"));
    assert.ok(timeline.length >= 1);
  });
});

const liveBinance = process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET;
const liveOkx =
  process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_PASSPHRASE;

describe("optional live exchange sync", { skip: !liveBinance && !liveOkx }, () => {
  it("binance live when BINANCE_* env set", async () => {
    if (!liveBinance) return;
    const txs = await fetchBinanceTransactions(
      { apiKey: process.env.BINANCE_API_KEY!, apiSecret: process.env.BINANCE_API_SECRET! },
      new Date().getFullYear()
    );
    assert.ok(Array.isArray(txs));
  });

  it("okx live when OKX_* env set", async () => {
    if (!liveOkx) return;
    const txs = await fetchOkxTransactions(
      {
        apiKey: process.env.OKX_API_KEY!,
        apiSecret: process.env.OKX_API_SECRET!,
        passphrase: process.env.OKX_PASSPHRASE!,
      },
      new Date().getFullYear()
    );
    assert.ok(Array.isArray(txs));
  });
});
