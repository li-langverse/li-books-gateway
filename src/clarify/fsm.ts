/** Clarification FSM — ADR-002; never auto-post on low confidence */

export type ReceiptStatus =
  | "draft"
  | "parsed"
  | "categorizing"
  | "needs_clarification"
  | "ready_to_post"
  | "posted";

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.85) return "HIGH";
  if (score >= 0.6) return "MEDIUM";
  return "LOW";
}

export type CategorizeInput = {
  status: ReceiptStatus;
  confidence: number;
  hasLawCitation: boolean;
  userConfirmed?: boolean;
};

export type CategorizeResult = {
  nextStatus: ReceiptStatus;
  requiresClarification: boolean;
  allowPost: boolean;
};

/** Never transition to posted without explicit confirm */
export function applyCategorize(input: CategorizeInput): CategorizeResult {
  const band = confidenceBand(input.confidence);
  if (input.userConfirmed && input.status === "ready_to_post") {
    return { nextStatus: "posted", requiresClarification: false, allowPost: true };
  }
  if (band === "LOW" || (band === "MEDIUM" && !input.hasLawCitation)) {
    return { nextStatus: "needs_clarification", requiresClarification: true, allowPost: false };
  }
  if ((band === "MEDIUM" || band === "HIGH") && input.hasLawCitation) {
    return { nextStatus: "ready_to_post", requiresClarification: false, allowPost: false };
  }
  return { nextStatus: "needs_clarification", requiresClarification: true, allowPost: false };
}

export function answerClarification(current: ReceiptStatus): ReceiptStatus {
  return current === "needs_clarification" ? "categorizing" : current;
}
