import { randomUUID } from "node:crypto";
import type { JournalEntry, LedgerStore, PostedReceipt } from "./store.js";

export function journalFromPostedReceipt(
  store: LedgerStore,
  receipt: PostedReceipt
): JournalEntry {
  const expense = store.accountByNumber(receipt.book_id, "4900");
  const bank = store.accountByNumber(receipt.book_id, "1200");
  if (!expense || !bank) throw new Error("default_accounts_missing");

  const amount = Math.round(receipt.amount * 100) / 100;
  const entry: JournalEntry = {
    id: randomUUID(),
    org_id: receipt.org_id,
    book_id: receipt.book_id,
    entry_date: receipt.spent_at,
    description: `Receipt ${receipt.merchant ?? receipt.id}`,
    receipt_id: receipt.id,
    source: "receipt_post",
    lines: [
      {
        id: randomUUID(),
        ledger_account_id: expense.id,
        debit: amount,
        credit: 0,
        tax_category_code: receipt.category_code,
      },
      {
        id: randomUUID(),
        ledger_account_id: bank.id,
        debit: 0,
        credit: amount,
      },
    ],
  };
  store.addEntry(entry);
  return entry;
}

export function summarizePeriod(
  store: LedgerStore,
  bookId: string,
  periodStart: string,
  periodEnd: string
): { expense_total: number; revenue_total: number } {
  let expense_total = 0;
  let revenue_total = 0;
  for (const e of store.entries.values()) {
    if (e.book_id !== bookId) continue;
    if (e.entry_date < periodStart || e.entry_date > periodEnd) continue;
    for (const l of e.lines) {
      const acct = store.accounts.get(l.ledger_account_id);
      if (!acct) continue;
      if (acct.account_type === "expense") expense_total += l.debit - l.credit;
      if (acct.account_type === "revenue") revenue_total += l.credit - l.debit;
    }
  }
  return {
    expense_total: Math.round(expense_total * 100) / 100,
    revenue_total: Math.round(revenue_total * 100) / 100,
  };
}
