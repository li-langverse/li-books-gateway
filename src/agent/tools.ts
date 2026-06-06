import { randomUUID } from "node:crypto";
import type { LedgerStore } from "../ledger/store.js";
import { journalFromPostedReceipt } from "../ledger/journal.js";
import { parseBankCsv } from "../ledger/bank-csv.js";
import { exportJournalCsv, exportDatevExtf } from "../export/formats.js";
import { buildUstvaSummary, generateUstvaXml, generateEurXml, validateElsterXml } from "../elster/xml.js";
import { handleLawSearch } from "../law-search.js";
import { applyCategorize } from "../clarify/fsm.js";
import { resolveTaxYear, type EntitlementStore, requireBookYearUnlocked } from "../billing/entitlements.js";
import { syncCrypto } from "../crypto/connectors.js";
import { buildMinuteTimeline, explainMinuteSpike } from "../crypto/tax-engine.js";
import type { CryptoTransaction, CryptoTaxMinute } from "../crypto/types.js";

export type AgentContext = {
  ledger: LedgerStore;
  org_id: string;
  book_id: string;
  tax_year: number;
  tax_domain: "freelance" | "company" | "income";
  entitlements: EntitlementStore;
};
export async function booksChatTurn(ctx: AgentContext, message: string) {
  return {
    role: "assistant" as const,
    content: `Ack (${ctx.tax_year}): ${message}`,
    book_id: ctx.book_id,
    tax_year: ctx.tax_year,
  };
}
export async function booksSubmitDocument(ctx: AgentContext, ocr_text: string) {
  const confidence = ocr_text.includes("Total") ? 0.7 : 0.4;
  const law = await handleLawSearch({ query: "Büro Ausgabe", tax_domain: "freelance", limit: 1 });
  const fsm = applyCategorize({ status: "parsed", confidence, hasLawCitation: law.length > 0 });
  return { confidence, clarification_required: fsm.requiresClarification, status: fsm.nextStatus };
}

export function booksAskClarification(_ctx: AgentContext, question: string) {
  return { thread_id: randomUUID(), question, status: "open" as const };
}

export function booksAnswerClarification(_ctx: AgentContext, thread_id: string, answer: string) {
  return { thread_id, answer, status: "resolved" as const };
}

export async function booksLawSearch(_ctx: AgentContext, query: string) {
  return handleLawSearch({ query, tax_domain: "freelance", limit: 5 });
}

export function booksTaxSummary(ctx: AgentContext, period_start: string, period_end: string) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock };
  return buildUstvaSummary(ctx.ledger, ctx.book_id, period_start, period_end);
}

export function booksConfirmPosting(ctx: AgentContext, receipt: {
  id: string;
  amount: number;
  spent_at: string;
  merchant: string | null;
  category_code: string;
  tax_year?: number;
}) {
  const tax_year = resolveTaxYear(receipt.spent_at, receipt.tax_year ?? ctx.tax_year);
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, tax_year, ctx.tax_domain);
  if (lock) return { posted: false, error: lock };
  const entry = journalFromPostedReceipt(ctx.ledger, {
    ...receipt,
    org_id: ctx.org_id,
    book_id: ctx.book_id,
  });
  return { posted: true, journal_entry_id: entry.id, tax_year };
}
export function booksImportBankCsv(ctx: AgentContext, csv: string) {
  const lines = parseBankCsv(csv);
  ctx.ledger.bankLines.push(...lines);
  return { imported: lines.length, needs_clarification: lines.filter((l) => l.needs_clarification).length };
}

export function booksExportCsv(ctx: AgentContext) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock, csv: "" };
  const entries = [...ctx.ledger.entries.values()].filter((e) => e.book_id === ctx.book_id);
  return { csv: exportJournalCsv(entries, ctx.ledger.accounts) };
}

export function booksExportDatev(ctx: AgentContext) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock, datev: "" };
  const entries = [...ctx.ledger.entries.values()].filter((e) => e.book_id === ctx.book_id);
  return { datev: exportDatevExtf(entries, ctx.ledger.accounts) };
}

export function booksExportElsterUstva(ctx: AgentContext, period_start: string, period_end: string) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock };
  const summary = buildUstvaSummary(ctx.ledger, ctx.book_id, period_start, period_end);
  const xml = generateUstvaXml(summary);
  return { xml, validation: validateElsterXml(xml), tax_year: ctx.tax_year };
}

export function booksExportElsterEur(ctx: AgentContext, period_start: string, period_end: string) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock };
  const xml = generateEurXml(ctx.ledger, ctx.book_id, period_start, period_end);
  return { xml, validation: validateElsterXml(xml), tax_year: ctx.tax_year };
}
export function booksCryptoSync(ctx: AgentContext, input: { source: "csv" | "kraken" | "binance" | "eth_wallet"; csv?: string }) {
  return syncCrypto({
    book_id: ctx.book_id,
    tax_year: ctx.tax_year,
    source: input.source,
    csv: input.csv,
  });
}

export function booksCryptoTaxTimeline(ctx: AgentContext, txs: CryptoTransaction[]) {
  const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, ctx.tax_year, ctx.tax_domain);
  if (lock) return { error: lock };
  return { timeline: buildMinuteTimeline(txs, ctx.tax_year, ctx.tax_domain), tax_year: ctx.tax_year };
}

export function booksCryptoExplainMinute(ctx: AgentContext, minute: CryptoTaxMinute, txs: CryptoTransaction[]) {
  return { explanation: explainMinuteSpike(minute, txs), tax_year: ctx.tax_year };
}

export const AGENT_TOOLS = [
  "books_chat_turn",
  "books_submit_document",
  "books_ask_clarification",
  "books_answer_clarification",
  "books_law_search",
  "books_tax_summary",
  "books_confirm_posting",
  "books_crypto_sync",
  "books_crypto_tax_timeline",
  "books_crypto_explain_minute",
] as const;
