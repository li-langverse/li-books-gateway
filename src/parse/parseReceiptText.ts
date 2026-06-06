/**
 * Best-effort extraction from noisy OCR output (Tesseract plain text or DeepSeek-style markdown).
 * User confirms in the UI; lines may be refined via `/api/receipt-parse` + optional LLM.
 */
import type {
  ParsedReceiptStructured,
  ReceiptLineDraft,
} from "./types.js";

export type { ParsedReceiptStructured, ReceiptLineDraft } from "./types.js";

/** @deprecated Use ParsedReceiptStructured — kept for quick imports */
export type ParsedReceiptGuess = ParsedReceiptStructured;

function hasMoneyContext(line: string): boolean {
  return /[$€£]|USD|EUR|GBP|total|sub\s*-?\s*total|subtotal|tax|vat|gst|hst|pst|due|balance|amount|pay|change|cash|card|disc/i.test(
    line,
  );
}

/** e.g. `12.30` could be $12.30 or a mis-OCR clock — exclude bare clocks unless context says money */
function looksLikeClockToken(token: string): boolean {
  const m = token.match(/^(\d{1,2})[.,](\d{2})$/);
  if (!m?.[1] || !m[2]) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function looksLikeTimeLine(line: string): boolean {
  const t = line.trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i.test(t)) return true;
  if (/^\d{1,2}[.,]\d{2}\s*(am|pm)$/i.test(t)) return true;
  if (/^time\b/i.test(t) && /\d/.test(t)) return true;
  return false;
}

function parseMoney(line: string): number | null {
  const patterns = [
    /(?:total|balance|due|amount)\s*[:\s]*\$?\s*(\d+[.,]\d{2})\b/i,
    /\$\s*(\d+[.,]\d{2})\b/,
    /\b(?:EUR|USD|GBP)\s*\$?\s*(\d+[.,]\d{2})\b/i,
    /\b(\d+[.,]\d{2})\s+(?:USD|EUR|GBP)\b/i,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m?.[1]) {
      const n = parseFloat(m[1].replace(",", "."));
      if (!Number.isNaN(n)) return Math.round(n * 100) / 100;
    }
  }
  const loose = line.match(/\b(\d+[.,]\d{2})\b/g);
  if (loose?.length) {
    const candidates = loose
      .filter((x) => {
        if (!looksLikeClockToken(x)) return true;
        return hasMoneyContext(line);
      })
      .map((x) => parseFloat(x.replace(",", ".")))
      .filter((n) => !Number.isNaN(n));
    if (candidates.length) return Math.round(Math.max(...candidates) * 100) / 100;
  }
  return null;
}

function parseDate(text: string): string | null {
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/;
  const m1 = text.match(iso);
  if (m1) {
    const y = m1[1];
    const mo = m1[2].padStart(2, "0");
    const d = m1[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const us = /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/;
  const m2 = text.match(us);
  if (m2) {
    const mo = m2[1].padStart(2, "0");
    const d = m2[2].padStart(2, "0");
    return `${m2[3]}-${mo}-${d}`;
  }
  return null;
}

function looksLikeMarkdownReceipt(raw: string): boolean {
  const t = raw.trim();
  if (t.includes("|") && t.split("\n").some((l) => l.includes("|"))) return true;
  if (/^#{1,3}\s+/m.test(t)) return true;
  if (/^\s*[-*]\s+.+\d+[.,]\d{2}/m.test(t)) return true;
  return false;
}

/** Markdown / pipe tables often produced by vision OCR models (e.g. DeepSeek-OCR-2). */
export function parseMarkdownStyleReceipt(raw: string): ReceiptLineDraft[] {
  const lines: ReceiptLineDraft[] = [];
  const rows = raw.split(/\r?\n/);

  for (const line of rows) {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) continue;
    if (/^\|[\s\-:|]+\|?$/.test(trimmed)) continue;

    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 2) continue;

    const lastCell = cells[cells.length - 1] ?? "";
    const priceMatch = lastCell.match(/(-?\d+[.,]\d{2})\s*$/);
    if (!priceMatch?.[1]) continue;

    const lineTotal = parseFloat(priceMatch[1].replace(",", "."));
    if (Number.isNaN(lineTotal)) continue;

    const nameParts = cells.slice(0, -1);
    const rawProductName = nameParts.join(" ").replace(/\s+/g, " ").trim();
    if (rawProductName.length < 1) continue;

    lines.push({
      rawProductName,
      rawLine: trimmed,
      lineTotal: Math.round(lineTotal * 100) / 100,
      unitPrice: null,
      quantity: null,
      suggestedCategory: null,
    });
  }

  return dedupeDraftLines(lines);
}

/** Plain receipt lines: `ITEM NAME          1.99` or trailing EUR 1,99 */
export function parsePlainLineItems(raw: string): ReceiptLineDraft[] {
  const lines: ReceiptLineDraft[] = [];
  const rows = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const row of rows) {
    if (/^total|subtotal|tax|balance|change|visa|cash|due$/i.test(row)) continue;
    const m =
      row.match(/^(.+?)\s+(-?\d+[.,]\d{2})\s*$/) ??
      row.match(/^(.+?)\s+(?:EUR|USD|GBP)\s*(-?\d+[.,]\d{2})\s*$/i);
    if (!m?.[1] || !m[2]) continue;
    const rawProductName = m[1].replace(/\s+/g, " ").trim();
    if (rawProductName.length < 2 || rawProductName.length > 120) continue;
    const lineTotal = parseFloat(m[2].replace(",", "."));
    if (Number.isNaN(lineTotal)) continue;
    lines.push({
      rawProductName,
      rawLine: row,
      lineTotal: Math.round(lineTotal * 100) / 100,
      unitPrice: null,
      quantity: null,
      suggestedCategory: null,
    });
  }

  return dedupeDraftLines(lines);
}

function dedupeDraftLines(lines: ReceiptLineDraft[]): ReceiptLineDraft[] {
  const seen = new Set<string>();
  const out: ReceiptLineDraft[] = [];
  for (const l of lines) {
    const key = `${l.rawProductName.toLowerCase()}|${l.lineTotal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function extractTotalFromMarkdown(raw: string): number | null {
  const block = raw.toLowerCase();
  const m =
    block.match(/\*\*total\*\*[^\d]*(\d+[.,]\d{2})/i) ??
    block.match(/#{1,3}\s*total[^\d]*(\d+[.,]\d{2})/i) ??
    block.match(/\btotal\s*[:]?\s*\$?\s*(\d+[.,]\d{2})/i);
  if (m?.[1]) {
    const n = parseFloat(m[1].replace(",", "."));
    if (!Number.isNaN(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

function extractMarkdownLabeledAmount(raw: string, rx: RegExp): number | null {
  const m = raw.match(rx);
  if (m?.[1]) {
    const n = parseFloat(m[1].replace(",", "."));
    if (!Number.isNaN(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

function extractSubtotalFromMarkdown(raw: string): number | null {
  return (
    extractMarkdownLabeledAmount(
      raw,
      /\*\*sub\s*total\*\*[^\d]*(\d+[.,]\d{2})/i,
    ) ??
    extractMarkdownLabeledAmount(raw, /#{1,3}\s*sub\s*total[^\d]*(\d+[.,]\d{2})/i) ??
    extractMarkdownLabeledAmount(
      raw,
      /\bsub\s*total\s*[:]?\s*\$?\s*(\d+[.,]\d{2})/i,
    )
  );
}

function extractTaxFromMarkdown(raw: string): number | null {
  return (
    extractMarkdownLabeledAmount(raw, /\*\*tax\*\*[^\d]*(\d+[.,]\d{2})/i) ??
    extractMarkdownLabeledAmount(raw, /#{1,3}\s*tax[^\d]*(\d+[.,]\d{2})/i) ??
    extractMarkdownLabeledAmount(
      raw,
      /\b(?:tax|vat|gst)\s*[:]?\s*\$?\s*(\d+[.,]\d{2})/i,
    )
  );
}

function extractLabeledLineAmount(flat: string[], labelRe: RegExp): number | null {
  for (const line of flat) {
    if (!labelRe.test(line.toLowerCase())) continue;
    const n = parseMoney(line);
    if (n != null) return n;
  }
  return null;
}

function extractSubtotalFromLines(flat: string[]): number | null {
  const n = extractLabeledLineAmount(flat, /\b(sub\s*-?\s*total|subtotal)\b/i);
  if (n != null) return n;
  return extractLabeledLineAmount(flat, /\b(items\s+total|net\s+amount)\b/i);
}

function extractTaxFromLines(flat: string[]): number | null {
  for (const line of flat) {
    const lower = line.toLowerCase();
    if (/\b(sub\s*-?\s*total|subtotal)\b/.test(lower)) continue;
    if (!/\b(tax|vat|gst|hst|pst)\b/i.test(line)) continue;
    const n = parseMoney(line);
    if (n != null) return n;
  }
  return null;
}

function extractTotalFromReceiptLines(flat: string[]): number | null {
  for (let i = flat.length - 1; i >= 0; i--) {
    const line = flat[i] ?? "";
    if (looksLikeTimeLine(line)) continue;
    if (
      /subtotal|sub\s+total/i.test(line) &&
      !/\b(grand\s+)?total\b/i.test(line)
    ) {
      continue;
    }
    if (
      /\b(tax|vat|gst)\b/i.test(line) &&
      !/\b(grand\s+)?total\b/i.test(line)
    ) {
      continue;
    }
    if (
      /\b(change|cash tender|amount tendered)\b/i.test(line) &&
      !/\b(grand\s+)?total\b/i.test(line)
    ) {
      continue;
    }
    if (
      /\b(total|amount\s+due|balance\s+due|grand\s+total)\b/i.test(line)
    ) {
      const n = parseMoney(line);
      if (n != null) return n;
    }
  }
  for (let i = flat.length - 1; i >= 0; i--) {
    const line = flat[i] ?? "";
    if (looksLikeTimeLine(line)) continue;
    const n = parseMoney(line);
    if (n != null) return n;
  }
  return null;
}

function isPlausibleMerchantLine(l: string): boolean {
  const t = l.trim();
  return (
    t.length > 2 &&
    t.length < 120 &&
    !/^\d+[.,]\d{2}$/.test(t) &&
    !looksLikeTimeLine(l) &&
    !l.includes("|") &&
    !/^\d+[.,]\d{2}\s*(am|pm)?$/i.test(t) &&
    !/^.+\s+\d+[.,]\d{2}\s*$/.test(t)
  );
}

function looksLikeStreetLine(l: string): boolean {
  const t = l.trim();
  if (t.length < 4) return false;
  if (
    /\d/.test(t) &&
    /(straße|strasse|street|st\.|road|rd\.|avenue|ave\.|blvd|boulevard|weg|platz|allee|lane)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\d{1,5}\s+[A-Za-zÄÖÜäöüß]/.test(t)) return true;
  return false;
}

/** Split header lines into store name vs street using simple OCR heuristics. */
export function guessMerchantFields(flat: string[]): {
  merchantName: string | null;
  merchantAddress: string | null;
} {
  const candidates = flat.filter((l) => isPlausibleMerchantLine(l));
  if (candidates.length === 0)
    return { merchantName: null, merchantAddress: null };

  if (candidates.length === 1) {
    const only = candidates[0]!;
    if (looksLikeStreetLine(only))
      return { merchantName: null, merchantAddress: only };
    return { merchantName: only, merchantAddress: null };
  }

  const first = candidates[0]!;
  const second = candidates[1]!;
  if (looksLikeStreetLine(first) && !looksLikeStreetLine(second)) {
    return { merchantName: second, merchantAddress: first };
  }
  return { merchantName: first, merchantAddress: second };
}

export type ParseReceiptOptions = {
  /** When set to `deepseek2`, prefer markdown/table heuristics when ambiguous. */
  ocrProvider?: "tesseract" | "deepseek2";
};

/**
 * Best-effort extraction of labeled checkout / terminal / verification fields from OCR
 * (German and common English card-slip wording).
 */
export function extractCardPaymentFields(raw: string): {
  checkoutNumber: string | null;
  terminalNumber: string | null;
  paymentChecksum: string | null;
} {
  let checkoutNumber: string | null = null;
  let terminalNumber: string | null = null;
  let paymentChecksum: string | null = null;

  const rows = raw.split(/\r?\n/);
  for (const line of rows) {
    const L = line.trim();
    if (!checkoutNumber) {
      const k = L.match(
        /\b(?:kassen?(?:[- ]nr\.?)?|checkout|bedienung|schalter)\s*[.:]?\s*(\d{1,6})\b/i,
      );
      if (k?.[1]) checkoutNumber = k[1];
    }
    if (!terminalNumber) {
      const t = L.match(
        /\bterminal(?:[- ]?(?:nr\.?|nummer|id|num\.?))?\s*[.:]?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,22})\b/i,
      );
      if (t?.[1]) terminalNumber = t[1];
    }
    if (!paymentChecksum) {
      let c = L.match(
        /\b(?:pr[uü]fziffer|pr[uü]fsumme|checksum)\s*[.:]?\s*([A-Za-z0-9*]{2,24})\b/i,
      );
      if (!c)
        c = L.match(/\b(?:stan|trace)\s*[.:]?\s*(\d{4,12})\b/i);
      if (!c)
        c = L.match(
          /\b(?:auth(?:orization)?|genehmigung)\s*(?:code|nr\.?)?\s*[.:]?\s*([A-Za-z0-9]{4,12})\b/i,
        );
      if (c?.[1]) paymentChecksum = c[1];
    }
  }

  return { checkoutNumber, terminalNumber, paymentChecksum };
}

/** Compact EU VAT ID: uppercase, remove spaces/punctuation (DE123456789, ATU12345678). */
export function normalizeEuVatId(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/**
 * Merchant VAT / USt-Id — labeled lines first (German/international wording), then a
 * conservative standalone DE######### on a short line.
 */
export function extractBusinessUstId(raw: string): string | null {
  const rows = raw.split(/\r?\n/);

  for (const line of rows) {
    const L = line.trim();
    const labeled = L.match(
      /\b(?:USt\.?\s*-?\s*(?:IdNr\.?|ID|Identifikations(?:nr|nummer)\.?)|Umsatzsteuer\s*[-:/]?\s*(?:ID|Nr\.?)|VAT\s*(?:ID|No\.?|Number)|Steuer\s*[-:]?\s*(?:Nr\.|ID))\s*[.:]?\s*([A-Z]{2}\s*[0-9A-Z][0-9A-Z\s\/\-]{6,18})\b/i,
    );
    if (labeled?.[1]) {
      const n = normalizeEuVatId(labeled[1]);
      if (n.length >= 10 && n.length <= 15) return n;
    }
  }

  for (const line of rows) {
    const L = line.trim();
    if (L.length > 120) continue;
    const de = L.match(/\b(DE\d{9})\b/i);
    if (de?.[1]) return de[1].toUpperCase();
  }

  return null;
}

export function parseReceiptText(
  raw: string,
  options?: ParseReceiptOptions,
): ParsedReceiptStructured {
  const preferMd =
    options?.ocrProvider === "deepseek2" || looksLikeMarkdownReceipt(raw);

  let lines: ReceiptLineDraft[] = [];
  if (preferMd) {
    lines = parseMarkdownStyleReceipt(raw);
    if (lines.length === 0) lines = parsePlainLineItems(raw);
  } else {
    lines = parsePlainLineItems(raw);
    if (lines.length === 0 && looksLikeMarkdownReceipt(raw)) {
      lines = parseMarkdownStyleReceipt(raw);
    }
  }

  const flat = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let subtotal = extractSubtotalFromMarkdown(raw) ?? extractSubtotalFromLines(flat);
  let tax = extractTaxFromMarkdown(raw) ?? extractTaxFromLines(flat);

  let amount: number | null = extractTotalFromMarkdown(raw);
  if (amount === null) {
    amount = extractTotalFromReceiptLines(flat);
  }
  if (amount === null && lines.length > 0) {
    const sum = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
    if (Math.abs(sum) > 1e-9) amount = Math.round(sum * 100) / 100;
  }

  const spentAt = parseDate(raw);
  const { merchantName, merchantAddress } = guessMerchantFields(flat);
  const cardMeta = extractCardPaymentFields(raw);
  const ustId = extractBusinessUstId(raw);

  return {
    amount,
    subtotal,
    tax,
    taxRatePercent: null,
    currency: "USD",
    spentAt,
    merchant: merchantName,
    merchantAddress,
    paymentMethod: null,
    paymentReference: null,
    checkoutNumber: cardMeta.checkoutNumber,
    terminalNumber: cardMeta.terminalNumber,
    paymentChecksum: cardMeta.paymentChecksum,
    ustId,
    lines,
  };
}
