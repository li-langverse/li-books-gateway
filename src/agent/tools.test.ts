import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledger/store.js";
import { EntitlementStore, completeYearUnlock } from "../billing/entitlements.js";
import {
  booksChatTurn,
  booksSubmitDocument,
  booksConfirmPosting,
  booksLawSearch,
  booksTaxSummary,
  booksAskClarification,
  booksAnswerClarification,
  AGENT_TOOLS,
} from "./tools.js";

describe("agent tools", () => {
  const ctx = (unlocked = true) => {
    const ledger = new LedgerStore();
    ledger.seedDefaultAccounts("org-1", "book-1");
    const entitlements = new EntitlementStore();
    if (unlocked) {
      completeYearUnlock(entitlements, {
        org_id: "org-1",
        book_id: "book-1",
        tax_year: 2024,
        tax_domain: "freelance",
        checkout_session_id: "cs_test",
      });
    }
    return {
      ledger,
      org_id: "org-1",
      book_id: "book-1",
      tax_year: 2024,
      tax_domain: "freelance" as const,
      entitlements,
    };
  };

  it("exports all required tool names including crypto", () => {
    for (const t of [
      "books_chat_turn",
      "books_submit_document",
      "books_ask_clarification",
      "books_answer_clarification",
      "books_law_search",
      "books_tax_summary",
      "books_confirm_posting",
      "books_crypto_sync",
      "books_crypto_tax_timeline",
      "books_crypto_explain_minute",
    ]) {
      assert.ok(AGENT_TOOLS.includes(t as typeof AGENT_TOOLS[number]));
    }
  });

  it("golden agent path: submit → clarify → post", async () => {
    const c = ctx();
    const sub = await booksSubmitDocument(c, "Shop\nTotal 10.00");
    assert.equal(sub.clarification_required, false);
    const ask = booksAskClarification(c, "Category?");
    const ans = booksAnswerClarification(c, ask.thread_id, "EXP_OFFICE");
    assert.equal(ans.status, "resolved");
    const post = booksConfirmPosting(c, {
      id: "r1",
      amount: 10,
      spent_at: "2024-06-01",
      merchant: "Shop",
      category_code: "EXP_OFFICE",
    });
    assert.ok(post.posted);
    const summary = booksTaxSummary(c, "2024-06-01", "2024-06-30");
    assert.equal((summary as { kz66: number }).kz66, 10);
    const chat = await booksChatTurn(c, "Status?");
    assert.match(chat.content, /Status/);
    const law = await booksLawSearch(c, "Kleinunternehmer");
    assert.ok(law.length >= 0);
  });

  it("blocks post when book-year locked", () => {
    const c = ctx(false);
    const post = booksConfirmPosting(c, {
      id: "r1",
      amount: 10,
      spent_at: "2024-06-01",
      merchant: "Shop",
      category_code: "EXP_OFFICE",
    });
    assert.equal(post.posted, false);
    assert.equal(post.error?.code, "BOOK_YEAR_LOCKED");
  });
});
