import type { ReceiptLineDraft } from "./types.js";

function nearlyEqual(a: number, b: number, eps = 0.06): boolean {
  return Math.abs(a - b) <= eps;
}

/** Card/cash tender wording — lines whose amount only repeats the receipt total are dropped elsewhere. */
const PAYMENT_HINT =
  /\b(kreditkarte|ec-karte|ec\s*karte|girocard|visa|mastercard|maestro|paypal|apple\s*pay|google\s*pay|contactless|tap\s+to\s+pay|barzahlung|\bcash\b|debitcard|debit\s+card)\b/i;

/**
 * Remove tender lines whose numeric total equals the receipt grand total (e.g. Kreditkarte 14.54
 * when the total is already 14.54).
 */
export function heuristicStripPaymentDuplicates(
  lines: ReceiptLineDraft[],
  grandTotal: number | null,
): ReceiptLineDraft[] {
  if (grandTotal == null) return lines;
  return lines.filter((row) => {
    const blob = `${row.rawProductName}\n${row.rawLine}`.toLowerCase();
    if (!PAYMENT_HINT.test(blob)) return true;
    if (row.lineTotal == null) return false;
    if (nearlyEqual(row.lineTotal, grandTotal)) return false;
    return true;
  });
}

/**
 * German-style VAT bucket rows (e.g. "A 7% …") — not merchandise lines.
 */
export function heuristicStripTaxBucketLines(
  lines: ReceiptLineDraft[],
): ReceiptLineDraft[] {
  return lines.filter((row) => {
    const combined = `${row.rawProductName} ${row.rawLine}`.trim();
    if (/^[AB]\s+\d+[,.]?\d*\s*%/i.test(combined)) return false;
    return true;
  });
}
