import { randomUUID } from "node:crypto";
import {
  createYearUnlockCheckout,
  type TaxDomain,
  type YearUnlockCheckoutInput,
  type YearUnlockCheckoutResult,
  YEAR_UNLOCK_PRICES_CENTS,
} from "./entitlements.js";

export type { TaxDomain, YearUnlockCheckoutInput, YearUnlockCheckoutResult };
export { createYearUnlockCheckout, YEAR_UNLOCK_PRICES_CENTS };

export type SignupWizardInput = {
  org_name: string;
  book_name: string;
  tax_domain: TaxDomain;
  /** First tax year to work on (defaults to current calendar year) */
  tax_year?: number;
  user_id: string;
};

export type SignupWizardResult = {
  org_id: string;
  book_id: string;
  member_role: "owner";
  tax_domain: TaxDomain;
  tax_year: number;
  /** Draft scan/clarify allowed; post/export require year unlock checkout */
  checkout?: YearUnlockCheckoutResult;
};

/** Signup creates org + book; billing is per book-year unlock (one-time), not subscription */
export function completeSignupWizard(input: SignupWizardInput): SignupWizardResult {
  const org_id = randomUUID();
  const book_id = randomUUID();
  const tax_year = input.tax_year ?? new Date().getFullYear();
  const result: SignupWizardResult = {
    org_id,
    book_id,
    member_role: "owner",
    tax_domain: input.tax_domain,
    tax_year,
    checkout: createYearUnlockCheckout({
      org_id,
      book_id,
      tax_year,
      tax_domain: input.tax_domain,
      email: `${input.user_id}@stub.local`,
      success_url: "https://books.stub/success",
      cancel_url: "https://books.stub/cancel",
    }),
  };
  return result;
}
