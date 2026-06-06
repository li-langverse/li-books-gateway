import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCategorize, confidenceBand } from "./fsm.js";

describe("clarification FSM", () => {
  it("never allows post without confirm", () => {
    const r = applyCategorize({
      status: "categorizing",
      confidence: 0.95,
      hasLawCitation: true,
    });
    assert.equal(r.allowPost, false);
    assert.equal(r.nextStatus, "ready_to_post");
  });

  it("requires clarification on low confidence", () => {
    const r = applyCategorize({
      status: "parsed",
      confidence: 0.4,
      hasLawCitation: false,
    });
    assert.equal(r.requiresClarification, true);
    assert.equal(r.nextStatus, "needs_clarification");
  });

  it("posts only after user confirm", () => {
    const r = applyCategorize({
      status: "ready_to_post",
      confidence: 0.9,
      hasLawCitation: true,
      userConfirmed: true,
    });
    assert.equal(r.nextStatus, "posted");
    assert.equal(r.allowPost, true);
  });

  it("bands confidence", () => {
    assert.equal(confidenceBand(0.9), "HIGH");
    assert.equal(confidenceBand(0.7), "MEDIUM");
    assert.equal(confidenceBand(0.3), "LOW");
  });
});
