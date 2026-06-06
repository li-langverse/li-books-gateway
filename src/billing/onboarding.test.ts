import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createYearUnlockCheckout,
  completeYearUnlock,
  requireBookYearUnlocked,
  EntitlementStore,
  YEAR_UNLOCK_PRICES_CENTS,
  resolveTaxYear,
} from "./entitlements.js";
import { completeSignupWizard } from "./onboarding.js";

describe("per-year billing (one-time unlock)", () => {
  it("prices differ by tax domain", () => {
    assert.equal(YEAR_UNLOCK_PRICES_CENTS.income, 2900);
    assert.equal(YEAR_UNLOCK_PRICES_CENTS.freelance, 4900);
    assert.equal(YEAR_UNLOCK_PRICES_CENTS.company, 9900);
  });

  it("creates one-time Stripe checkout for book + tax_year", () => {
    const r = createYearUnlockCheckout({
      org_id: "org-1",
      book_id: "book-1",
      tax_year: 2024,
      tax_domain: "freelance",
      email: "a@test.de",
      success_url: "https://ok",
      cancel_url: "https://no",
    });
    assert.equal(r.stub, true);
    assert.equal(r.amount_cents, 4900);
    assert.match(r.url, /year=2024/);
  });

  it("blocks post/export until year unlocked", () => {
    const store = new EntitlementStore();
    const locked = requireBookYearUnlocked(store, "book-1", 2025, "freelance");
    assert.equal(locked?.code, "BOOK_YEAR_LOCKED");
    completeYearUnlock(store, {
      org_id: "org-1",
      book_id: "book-1",
      tax_year: 2025,
      tax_domain: "freelance",
      checkout_session_id: "cs_test",
    });
    assert.equal(requireBookYearUnlocked(store, "book-1", 2025), null);
  });

  it("signup wizard returns year unlock checkout (not subscription)", () => {
    const r = completeSignupWizard({
      org_name: "Freelancer",
      book_name: "2024",
      tax_domain: "freelance",
      tax_year: 2024,
      user_id: "user-1",
    });
    assert.ok(r.org_id);
    assert.ok(r.book_id);
    assert.equal(r.tax_year, 2024);
    assert.ok(r.checkout);
    assert.equal(r.checkout!.amount_cents, 4900);
  });

  it("resolveTaxYear from spent_at or explicit override", () => {
    assert.equal(resolveTaxYear("2023-11-15"), 2023);
    assert.equal(resolveTaxYear("2024-06-01", 2025), 2025);
  });
});
