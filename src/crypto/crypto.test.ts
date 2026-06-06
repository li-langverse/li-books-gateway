import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExchangeCsv } from "./connectors.js";
import { buildMinuteTimeline } from "./tax-engine.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dir, "..", "..", "tests", "fixtures", "crypto");

const FIXTURE_CSV = `time,type,asset,amount,eur
2024-06-15T14:32:00Z,sell,BTC,-0.01,450.00
2024-06-15T14:32:00Z,fee,BTC,-0.0001,2.50
2024-06-15T15:00:00Z,staking_reward,ETH,0.05,120.00`;

describe("crypto connectors", () => {
  it("parses exchange CSV into transactions", () => {
    const txs = parseExchangeCsv(FIXTURE_CSV, 2024);
    assert.equal(txs.length, 3);
    assert.equal(txs[0]!.tx_type, "sell");
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
