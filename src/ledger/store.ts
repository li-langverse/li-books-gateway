import { randomUUID } from "node:crypto";

export type LedgerAccount = {
  id: string;
  org_id: string;
  book_id: string;
  account_number: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
};

export type JournalLine = {
  id: string;
  ledger_account_id: string;
  debit: number;
  credit: number;
  tax_category_code?: string;
  memo?: string;
};

export type JournalEntry = {
  id: string;
  org_id: string;
  book_id: string;
  entry_date: string;
  description: string;
  receipt_id?: string;
  source: "manual" | "receipt_post" | "bank_import" | "adjustment";
  lines: JournalLine[];
};

export type PostedReceipt = {
  id: string;
  org_id: string;
  book_id: string;
  amount: number;
  spent_at: string;
  merchant: string | null;
  category_code: string;
};

export type TaxPeriodClose = {
  id: string;
  org_id: string;
  book_id: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed" | "exported";
};

export type BankImportLine = {
  line_index: number;
  booking_date: string;
  amount: number;
  counterparty: string | null;
  reference: string | null;
  needs_clarification: boolean;
};

/** In-memory ledger for gateway integration tests (lidb contract mirror) */
export class LedgerStore {
  accounts = new Map<string, LedgerAccount>();
  entries = new Map<string, JournalEntry>();
  periods = new Map<string, TaxPeriodClose>();
  bankLines: BankImportLine[] = [];

  seedDefaultAccounts(orgId: string, bookId: string): void {
    const defs: [string, string, LedgerAccount["account_type"]][] = [
      ["1200", "Bank", "asset"],
      ["8400", "Erloese", "revenue"],
      ["4900", "Sonstige Aufwendungen", "expense"],
      ["1576", "Abziehbare Vorsteuer 19%", "asset"],
    ];
    for (const [num, name, type] of defs) {
      const id = randomUUID();
      this.accounts.set(id, {
        id,
        org_id: orgId,
        book_id: bookId,
        account_number: num,
        name,
        account_type: type,
      });
    }
  }

  accountByNumber(bookId: string, num: string): LedgerAccount | undefined {
    return [...this.accounts.values()].find(
      (a) => a.book_id === bookId && a.account_number === num
    );
  }

  addEntry(entry: JournalEntry): void {
    const debits = entry.lines.reduce((s, l) => s + l.debit, 0);
    const credits = entry.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(debits - credits) > 0.001) {
      throw new Error("journal_unbalanced");
    }
    this.entries.set(entry.id, entry);
  }

  balanceSheet(bookId: string): { debits: number; credits: number } {
    let debits = 0;
    let credits = 0;
    for (const e of this.entries.values()) {
      if (e.book_id !== bookId) continue;
      for (const l of e.lines) {
        debits += l.debit;
        credits += l.credit;
      }
    }
    return { debits, credits };
  }
}
