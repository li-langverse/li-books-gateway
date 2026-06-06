import { formatMoneyTwoDecimals, roundToCents } from "./moneyFormat.js";

/** Amount to add to the sum of line totals so it equals subtotal (negative = lines are too high). */
export function netAdjustmentForLines(diffLineSumMinusSubtotal: number): number {
  return roundToCents(-diffLineSumMinusSubtotal);
}

export type GapDirection = "short" | "over";

export function lineSumGapDirection(
  diffLineSumMinusSubtotal: number,
): GapDirection {
  return diffLineSumMinusSubtotal < 0 ? "short" : "over";
}

/**
 * Human-readable explanation of line-sum vs subtotal mismatch (no LLM).
 */
export function describeLineSumGapPlain(
  diffLineSumMinusSubtotal: number,
  currency: string,
): string {
  const mag = formatMoneyTwoDecimals(Math.abs(diffLineSumMinusSubtotal));
  if (diffLineSumMinusSubtotal < 0) {
    return `The sum of product line totals is ${mag} ${currency} below the subtotal — as if a line (~${mag} ${currency}) is missing, misread, or a discount was dropped.`;
  }
  return `The sum of product line totals is ${mag} ${currency} above the subtotal — a duplicated line, wrong price/qty, or subtotal taken from the wrong line are common causes.`;
}
