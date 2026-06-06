import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LedgerStore } from "./store.js";
import { journalFromPostedReceipt, summarizePeriod } from "./journal.js";
import { parseBankCsv } from "./bank-csv.js";
import { exportJournalCsv, exportDatevExtf } from "../export/formats.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dir, "..", "..", "tests", "fixtures", "exports");

describe("ledger journal", () => {
  it("balanced entry from posted receipt", () => {
    const store = new LedgerStore();
    store.seedDefaultAccounts("org-1", "book-1");
    const entry = journalFromPostedReceipt(store, {
      id: "r1",
      org_id: "org-1",
      book_id: "book-1",
      amount: 119.0,
      spent_at: "2024-06-15",
      merchant: "REWE",
      category_code: "EXP_OFFICE",
    });
    const bal = store.balanceSheet("book-1");
    assert.equal(bal.debits, bal.credits);
    assert.equal(entry.lines.length, 2);
  });

  it("period summary totals expenses", () => {
    const store = new LedgerStore();
    store.seedDefaultAccounts("org-1", "book-1");
    journalFromPostedReceipt(store, {
      id: "r1",
      org_id: "org-1",
      book_id: "book-1",
      amount: 50,
      spent_at: "2024-06-01",
      merchant: "X",
      category_code: "EXP_OFFICE",
    });
    const s = summarizePeriod(store, "book-1", "2024-06-01", "2024-06-30");
    assert.equal(s.expense_total, 50);
  });
});

describe("bank CSV import", () => {
  it("parses German bank CSV and flags large unclear rows", () => {
    const csv = "Buchungstag;Betrag;Empfaenger;Verwendungszweck\n01.06.2024;-50,00;REWE;Einkauf\n02.06.2024;-600,00;Unknown;";
    const lines = parseBankCsv(csv);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]!.booking_date, "2024-06-01");
    assert.equal(lines[1]!.needs_clarification, true);
  });
});

describe("export snapshots", () => {
  it("matches CSV golden file", () => {
    const store = new LedgerStore();
    store.seedDefaultAccounts("org-1", "book-1");
    const entry = journalFromPostedReceipt(store, {
      id: "r1",
      org_id: "org-1",
      book_id: "book-1",
      amount: 19.99,
      spent_at: "2024-06-01",
      merchant: "REWE",
      category_code: "EXP_OFFICE",
    });
    const csv = exportJournalCsv([entry], store.accounts);
    if (!existsSync(FIX)) mkdirSync(FIX, { recursive: true });
    const golden = join(FIX, "journal.csv");
    if (!existsSync(golden)) writeFileSync(golden, csv);
    assert.equal(csv, readFileSync(golden, "utf8"));
  });

  it("DATEV EXTF contains EXTF header", () => {
    const store = new LedgerStore();
    store.seedDefaultAccounts("org-1", "book-1");
    const entry = journalFromPostedReceipt(store, {
      id: "r1",
      org_id: "org-1",
      book_id: "book-1",
      amount: 10,
      spent_at: "2024-06-01",
      merchant: "Test",
      category_code: "EXP_OFFICE",
    });
    const datev = exportDatevExtf([entry], store.accounts);
    assert.match(datev, /^EXTF;510/);
  });
});
