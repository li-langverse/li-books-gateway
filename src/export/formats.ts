import type { JournalEntry, LedgerAccount } from "../ledger/store.js";

export function exportJournalCsv(entries: JournalEntry[], accounts: Map<string, LedgerAccount>): string {
  const header = "entry_date,account_number,account_name,debit,credit,memo";
  const rows: string[] = [header];
  for (const e of entries) {
    for (const l of e.lines) {
      const acct = accounts.get(l.ledger_account_id);
      rows.push(
        [
          e.entry_date,
          acct?.account_number ?? "",
          acct?.name ?? "",
          l.debit.toFixed(2),
          l.credit.toFixed(2),
          (l.memo ?? e.description).replace(/,/g, " "),
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

/** Minimal DATEV Buchungsstapel header (EXTF 510) — snapshot-friendly subset */
export function exportDatevExtf(
  entries: JournalEntry[],
  accounts: Map<string, LedgerAccount>,
  opts: { consultantNumber?: string; clientNumber?: string; fiscalYearStart?: string } = {}
): string {
  const consultant = opts.consultantNumber ?? "1000";
  const client = opts.clientNumber ?? "10001";
  const fy = opts.fiscalYearStart ?? "20240101";
  const header = [
    "EXTF",
    "510",
    "21",
    "Buchungsstapel",
    "7",
    "",
    "",
    "EUR",
    "",
    "",
    "",
    consultant,
    client,
    fy,
    "4",
    "",
    "",
    "",
    "",
  ].join(";");
  const rows = [header, '"Umsatz";"SollHabenKennzeichen";"WKZUmsatz";"Kurs";"Bumsatz";"Konto";"Gegenkonto";"BU-Schlüssel";"Belegdatum";"Belegfeld1";"Buchungstext"'];
  for (const e of entries) {
    const debitLine = e.lines.find((l) => l.debit > 0);
    const creditLine = e.lines.find((l) => l.credit > 0);
    if (!debitLine || !creditLine) continue;
    const konto = accounts.get(debitLine.ledger_account_id)?.account_number ?? "4900";
    const gegen = accounts.get(creditLine.ledger_account_id)?.account_number ?? "1200";
    const amount = debitLine.debit.toFixed(2).replace(".", ",");
    const date = e.entry_date.replace(/-/g, "");
    rows.push(
      `"${amount}";"S";"";"";"";"${konto}";"${gegen}";"";"${date}";"${e.receipt_id ?? e.id.slice(0, 8)}";"${e.description.replace(/"/g, "'")}"`
    );
  }
  return rows.join("\n");
}
