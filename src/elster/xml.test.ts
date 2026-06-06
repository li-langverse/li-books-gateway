import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LedgerStore } from "../ledger/store.js";
import { journalFromPostedReceipt } from "../ledger/journal.js";
import {
  buildUstvaSummary,
  generateUstvaXml,
  generateEurXml,
  validateElsterXml,
  submitElster,
} from "./xml.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dir, "..", "..", "tests", "fixtures", "elster");

function seedStore(): LedgerStore {
  const store = new LedgerStore();
  store.seedDefaultAccounts("org-1", "book-1");
  journalFromPostedReceipt(store, {
    id: "r1",
    org_id: "org-1",
    book_id: "book-1",
    amount: 100,
    spent_at: "2024-06-15",
    merchant: "Client",
    category_code: "EXP_SOFTWARE",
  });
  return store;
}

describe("Elster M1 XML", () => {
  it("generates UStVA XML matching golden", () => {
    const store = seedStore();
    const summary = buildUstvaSummary(store, "book-1", "2024-06-01", "2024-06-30");
    const xml = generateUstvaXml(summary);
    if (!existsSync(FIX)) mkdirSync(FIX, { recursive: true });
    const golden = join(FIX, "ustva.xml");
    if (!existsSync(golden)) writeFileSync(golden, xml);
    assert.equal(xml, readFileSync(golden, "utf8"));
    assert.match(xml, /<Kz66>100\.00<\/Kz66>/);
  });

  it("generates EÜR XML", () => {
    const store = seedStore();
    const xml = generateEurXml(store, "book-1", "2024-06-01", "2024-06-30");
    assert.match(xml, /<Betriebsausgaben>100\.00<\/Betriebsausgaben>/);
  });
});

describe("Elster M2 validate", () => {
  it("validates well-formed XML", () => {
    const store = seedStore();
    const xml = generateUstvaXml(buildUstvaSummary(store, "book-1", "2024-06-01", "2024-06-30"));
    const v = validateElsterXml(xml);
    assert.equal(v.valid, true);
  });
});

describe("Elster M3/M4 stub", () => {
  it("blocks submit without cert", () => {
    const r = submitElster("<Elster></Elster>");
    assert.equal(r.status, "blocked");
  });
});
