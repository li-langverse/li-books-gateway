/**
 * Currency-style amounts: always two digits after the decimal (cents).
 */

/** Round to nearest cent (half-up). */
export function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format with exactly two fractional digits; uses `.` as decimal separator. */
export function formatMoneyTwoDecimals(n: number): string {
  return roundToCents(n).toFixed(2);
}

/** Parse user input with `,` or `.` as decimal separator; returns cents-rounded number or null. */
export function parseMoneyLoose(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return roundToCents(n);
}

/** Display string for optional numeric amount (empty when unset). */
export function formatMoneyOptional(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return formatMoneyTwoDecimals(n);
}

/**
 * After blur: if the field parses as money, return canonical two-decimal string;
 * otherwise return trimmed raw (user may still be editing invalid input).
 */
export function normalizeMoneyInputOnBlur(raw: string): string {
  const v = parseMoneyLoose(raw);
  if (v == null) return raw.trim();
  return formatMoneyTwoDecimals(v);
}

export type LinesVsSubtotalResult =
  | {
      kind: "skip";
      reason: "no_lines" | "no_subtotal";
    }
  | {
      kind: "compare";
      lineSum: number;
      subtotal: number;
      diff: number;
      matches: boolean;
      /** True when lines sum to ~subtotal+tax (line totals incl. VAT, subtotal net). */
      alignedViaTax?: boolean;
    };

const DEFAULT_TOLERANCE = 0.02;

export type CompareLinesToSubtotalOptions = {
  tolerance?: number;
  /**
   * Receipt VAT/sales tax amount. When set, we also accept
   * `sum(line totals) ≈ subtotal + tax` (common when printed line prices include VAT
   * but the subtotal row is before tax).
   */
  taxAmountStr?: string;
};

/**
 * Sum parsed line totals (skipping blank/invalid rows) and compare to subtotal string.
 */
export function compareLineTotalsToSubtotal(
  lineTotalStrings: readonly string[],
  subtotalStr: string,
  toleranceOrOpts?: number | CompareLinesToSubtotalOptions,
): LinesVsSubtotalResult {
  const opts: CompareLinesToSubtotalOptions =
    typeof toleranceOrOpts === "number"
      ? { tolerance: toleranceOrOpts }
      : (toleranceOrOpts ?? {});
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;

  let cents = 0;
  let anyLine = false;
  for (const s of lineTotalStrings) {
    const v = parseMoneyLoose(s);
    if (v != null) {
      cents += Math.round(v * 100);
      anyLine = true;
    }
  }
  const sub = parseMoneyLoose(subtotalStr);
  if (!anyLine) return { kind: "skip", reason: "no_lines" };
  if (sub == null) return { kind: "skip", reason: "no_subtotal" };

  const lineSum = cents / 100;
  const diff = roundToCents(lineSum - sub);
  let matches = Math.abs(diff) <= tolerance;
  let alignedViaTax = false;

  const tax = parseMoneyLoose(opts.taxAmountStr ?? "");
  if (!matches && tax != null && tax > 0) {
    const residual = roundToCents(lineSum - sub - tax);
    if (Math.abs(residual) <= tolerance) {
      matches = true;
      alignedViaTax = true;
    }
  }

  return {
    kind: "compare",
    lineSum,
    subtotal: sub,
    diff,
    matches,
    ...(alignedViaTax ? { alignedViaTax: true } : {}),
  };
}
