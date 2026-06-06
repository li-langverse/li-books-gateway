import type { BankImportLine } from "./store.js";

/** Parse German bank CSV: Buchungstag;Betrag;Empfaenger;Verwendungszweck */
export function parseBankCsv(csv: string): BankImportLine[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out: BankImportLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(";");
    if (parts.length < 4) continue;
    const [dateRaw, amountRaw, counterparty, reference] = parts;
    const amount = parseFloat(amountRaw!.replace(",", "."));
    if (Number.isNaN(amount)) continue;
    const needs_clarification = Math.abs(amount) > 500 && !reference?.trim();
    out.push({
      line_index: i - 1,
      booking_date: normalizeDate(dateRaw!.trim()),
      amount,
      counterparty: counterparty?.trim() ?? null,
      reference: reference?.trim() ?? null,
      needs_clarification,
    });
  }
  return out;
}

function normalizeDate(raw: string): string {
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw;
}
