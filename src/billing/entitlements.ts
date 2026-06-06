import { randomUUID } from "node:crypto";

export type TaxDomain = "freelance" | "company" | "income";

/** One-time unlock price per tax domain (cents EUR) — not a subscription */
export const YEAR_UNLOCK_PRICES_CENTS: Record<TaxDomain, number> = {
  income: 2900,
  freelance: 4900,
  company: 9900,
};

export type BookYearEntitlement = {
  id: string;
  org_id: string;
  book_id: string;
  tax_year: number;
  tax_domain: TaxDomain;
  unlocked_at: string;
  stripe_checkout_session_id?: string;
  amount_cents: number;
  currency: string;
};

export type YearUnlockCheckoutInput = {
  org_id: string;
  book_id: string;
  tax_year: number;
  tax_domain: TaxDomain;
  email: string;
  success_url: string;
  cancel_url: string;
};

export type YearUnlockCheckoutResult = {
  checkout_session_id: string;
  url: string;
  amount_cents: number;
  tax_domain: TaxDomain;
  tax_year: number;
  stub: boolean;
};

/** In-memory store for dev/tests; lidb `book_year_entitlement` in prod */
export class EntitlementStore {
  readonly entitlements = new Map<string, BookYearEntitlement>();

  key(book_id: string, tax_year: number): string {
    return `${book_id}:${tax_year}`;
  }

  isUnlocked(book_id: string, tax_year: number): boolean {
    return this.entitlements.has(this.key(book_id, tax_year));
  }

  grant(input: Omit<BookYearEntitlement, "id" | "unlocked_at">): BookYearEntitlement {
    const ent: BookYearEntitlement = {
      id: randomUUID(),
      unlocked_at: new Date().toISOString(),
      ...input,
    };
    this.entitlements.set(this.key(input.book_id, input.tax_year), ent);
    return ent;
  }

  listForBook(book_id: string): BookYearEntitlement[] {
    return [...this.entitlements.values()].filter((e) => e.book_id === book_id);
  }
}

export const defaultEntitlements = new EntitlementStore();

export function resolveTaxYear(spent_at: string, explicit?: number): number {
  if (explicit != null) return explicit;
  const y = parseInt(spent_at.slice(0, 4), 10);
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

export function createYearUnlockCheckout(input: YearUnlockCheckoutInput): YearUnlockCheckoutResult {
  const amount_cents = YEAR_UNLOCK_PRICES_CENTS[input.tax_domain];
  const session_id = `cs_year_${input.tax_domain}_${input.tax_year}_stub`;
  return {
    checkout_session_id: session_id,
    url: `https://checkout.stripe.com/stub/year-unlock?book=${input.book_id}&year=${input.tax_year}&domain=${input.tax_domain}`,
    amount_cents,
    tax_domain: input.tax_domain,
    tax_year: input.tax_year,
    stub: true,
  };
}

/** Stub webhook handler — grants entitlement after one-time payment */
export function completeYearUnlock(
  store: EntitlementStore,
  input: {
    org_id: string;
    book_id: string;
    tax_year: number;
    tax_domain: TaxDomain;
    checkout_session_id: string;
  }
): BookYearEntitlement {
  return store.grant({
    org_id: input.org_id,
    book_id: input.book_id,
    tax_year: input.tax_year,
    tax_domain: input.tax_domain,
    stripe_checkout_session_id: input.checkout_session_id,
    amount_cents: YEAR_UNLOCK_PRICES_CENTS[input.tax_domain],
    currency: "EUR",
  });
}

export type EntitlementError = { code: "BOOK_YEAR_LOCKED"; tax_year: number; unlock_url: string };

export function requireBookYearUnlocked(
  store: EntitlementStore,
  book_id: string,
  tax_year: number,
  tax_domain: TaxDomain = "freelance"
): EntitlementError | null {
  if (store.isUnlocked(book_id, tax_year)) return null;
  const checkout = createYearUnlockCheckout({
    org_id: "",
    book_id,
    tax_year,
    tax_domain,
    email: "stub@local",
    success_url: "https://books.stub/success",
    cancel_url: "https://books.stub/cancel",
  });
  return {
    code: "BOOK_YEAR_LOCKED",
    tax_year,
    unlock_url: checkout.url,
  };
}
