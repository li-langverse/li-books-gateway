import type { IncomingMessage, ServerResponse } from "node:http";
import { parseReceiptText } from "./parse/parseReceiptText.js";
import { applyCategorize } from "./clarify/fsm.js";
import { handleLawSearch } from "./law-search.js";
import { LedgerStore } from "./ledger/store.js";
import { parseBankCsv } from "./ledger/bank-csv.js";
import {
  booksChatTurn,
  booksSubmitDocument,
  booksConfirmPosting,
  booksImportBankCsv,
  booksExportCsv,
  booksExportDatev,
  booksExportElsterUstva,
  booksExportElsterEur,
  booksTaxSummary,
} from "./agent/tools.js";
import { completeSignupWizard, createYearUnlockCheckout } from "./billing/onboarding.js";
import {
  defaultEntitlements,
  completeYearUnlock,
  requireBookYearUnlocked,
  resolveTaxYear,
} from "./billing/entitlements.js";
import { syncCrypto, parseExchangeCsv, defaultAdapterRegistry } from "./crypto/connectors.js";
import { defaultCryptoStore } from "./crypto/store.js";
import { buildMinuteTimeline } from "./crypto/tax-engine.js";
import { randomUUID } from "node:crypto";

export const defaultLedger = new LedgerStore();

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function agentCtx(body: {
  org_id?: string;
  book_id?: string;
  tax_year?: number;
  tax_domain?: "freelance" | "company" | "income";
}) {
  const org_id = body.org_id ?? "00000000-0000-0000-0000-000000000001";
  const book_id = body.book_id ?? "00000000-0000-0000-0000-000000000002";
  const tax_year = body.tax_year ?? new Date().getFullYear();
  const tax_domain = body.tax_domain ?? "freelance";
  if (!defaultLedger.accountByNumber(book_id, "4900")) {
    defaultLedger.seedDefaultAccounts(org_id, book_id);
  }
  return { ledger: defaultLedger, org_id, book_id, tax_year, tax_domain, entitlements: defaultEntitlements };
}

export async function handleChatMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ message: string; org_id?: string; book_id?: string }>(req);
  const ctx = agentCtx(body);
  const reply = await booksChatTurn(ctx, body.message);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseWrite(res, "message", reply);
  sseWrite(res, "done", { ok: true });
  res.end();
}

export async function handleReceiptParse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ ocr_text: string; ocr_provider?: string; tax_year?: number }>(req);
  const parsed = parseReceiptText(body.ocr_text, {
    ocrProvider: body.ocr_provider as "tesseract" | "deepseek2" | undefined,
  });
  const tax_year = body.tax_year ?? (parsed.spentAt ? resolveTaxYear(parsed.spentAt) : new Date().getFullYear());
  const confidence = parsed.amount != null ? 0.75 : 0.45;
  const lawHits = await handleLawSearch({
    query: parsed.merchant ?? "Bewirtung Büro",
    tax_domain: "freelance",
    limit: 1,
  });
  const fsm = applyCategorize({
    status: "parsed",
    confidence,
    hasLawCitation: lawHits.length > 0,
  });
  json(res, 200, {
    parsed,
    tax_year,
    confidence,
    law_citations: lawHits,
    clarification_required: fsm.requiresClarification,
    status: fsm.nextStatus,
    draft: true,
  });
}

export function createBooksRouter() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, product: "li-books" });
      return;
    }

    if (url.pathname === "/v1/chat/messages" && req.method === "POST") {
      await handleChatMessages(req, res);
      return;
    }

    if (url.pathname === "/v1/receipts/parse" && req.method === "POST") {
      await handleReceiptParse(req, res);
      return;
    }

    if (url.pathname === "/v1/law/search" && req.method === "POST") {
      const body = await readJson<{ query: string; tax_domain?: "freelance" | "company" | "income" }>(req);
      const hits = await handleLawSearch(body);
      json(res, 200, { hits });
      return;
    }

    if (url.pathname === "/v1/bank/import" && req.method === "POST") {
      const body = await readJson<{ csv: string; org_id?: string; book_id?: string }>(req);
      const ctx = agentCtx(body);
      json(res, 200, booksImportBankCsv(ctx, body.csv));
      return;
    }

    if (url.pathname === "/v1/receipts/post" && req.method === "POST") {
      const body = await readJson<{
        id?: string;
        amount: number;
        spent_at: string;
        merchant: string | null;
        category_code: string;
        org_id?: string;
        book_id?: string;
        tax_year?: number;
        tax_domain?: "freelance" | "company" | "income";
      }>(req);
      const ctx = agentCtx(body);
      const result = booksConfirmPosting(ctx, { ...body, id: body.id ?? randomUUID() });
      json(res, result.posted ? 200 : 402, result);
      return;
    }

    if (url.pathname === "/v1/export/csv" && req.method === "GET") {
      const ctx = agentCtx({
        org_id: url.searchParams.get("org_id") ?? undefined,
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year: parseInt(url.searchParams.get("tax_year") ?? "", 10) || undefined,
      });
      const out = booksExportCsv(ctx);
      if ("error" in out && out.error) {
        json(res, 402, out);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(out.csv);
      return;
    }

    if (url.pathname === "/v1/export/datev" && req.method === "GET") {
      const ctx = agentCtx({
        org_id: url.searchParams.get("org_id") ?? undefined,
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year: parseInt(url.searchParams.get("tax_year") ?? "", 10) || undefined,
      });
      const out = booksExportDatev(ctx);
      if ("error" in out && out.error) {
        json(res, 402, out);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(out.datev);
      return;
    }

    if (url.pathname === "/v1/export/elster/ustva" && req.method === "GET") {
      const ctx = agentCtx({
        org_id: url.searchParams.get("org_id") ?? undefined,
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year: parseInt(url.searchParams.get("tax_year") ?? "", 10) || undefined,
      });
      const ps = url.searchParams.get("period_start") ?? "2024-06-01";
      const pe = url.searchParams.get("period_end") ?? "2024-06-30";
      const out = booksExportElsterUstva(ctx, ps, pe);
      json(res, "error" in out && out.error ? 402 : 200, out);
      return;
    }

    if (url.pathname === "/v1/export/elster/eur" && req.method === "GET") {
      const ctx = agentCtx({
        org_id: url.searchParams.get("org_id") ?? undefined,
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year: parseInt(url.searchParams.get("tax_year") ?? "", 10) || undefined,
      });
      const ps = url.searchParams.get("period_start") ?? "2024-06-01";
      const pe = url.searchParams.get("period_end") ?? "2024-06-30";
      const out = booksExportElsterEur(ctx, ps, pe);
      json(res, "error" in out && out.error ? 402 : 200, out);
      return;
    }

    if (url.pathname === "/v1/tax/summary" && req.method === "GET") {
      const ctx = agentCtx({
        org_id: url.searchParams.get("org_id") ?? undefined,
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year: parseInt(url.searchParams.get("tax_year") ?? "", 10) || undefined,
      });
      const out = booksTaxSummary(
        ctx,
        url.searchParams.get("period_start") ?? "2024-06-01",
        url.searchParams.get("period_end") ?? "2024-06-30"
      );
      json(res, "error" in out && out.error ? 402 : 200, out);
      return;
    }

    if (url.pathname === "/v1/billing/checkout" && req.method === "POST") {
      const body = await readJson<{
        org_id: string;
        book_id: string;
        tax_year: number;
        tax_domain: "freelance" | "company" | "income";
        email: string;
        success_url: string;
        cancel_url: string;
      }>(req);
      json(res, 200, createYearUnlockCheckout(body));
      return;
    }

    if (url.pathname === "/v1/billing/unlock" && req.method === "POST") {
      const body = await readJson<{
        org_id: string;
        book_id: string;
        tax_year: number;
        tax_domain: "freelance" | "company" | "income";
        checkout_session_id: string;
      }>(req);
      json(res, 200, completeYearUnlock(defaultEntitlements, body));
      return;
    }

    if (url.pathname === "/v1/billing/entitlements" && req.method === "GET") {
      const book_id = url.searchParams.get("book_id") ?? "";
      json(res, 200, { entitlements: defaultEntitlements.listForBook(book_id) });
      return;
    }

    if (url.pathname === "/v1/onboarding/signup" && req.method === "POST") {
      const body = await readJson<{
        org_name: string;
        book_name: string;
        tax_domain: "freelance" | "company" | "income";
        tax_year?: number;
        user_id: string;
      }>(req);
      json(res, 201, completeSignupWizard(body));
      return;
    }

    if (url.pathname === "/v1/crypto/sources" && req.method === "GET") {
      json(res, 200, { sources: defaultAdapterRegistry.listSources() });
      return;
    }

    if (url.pathname === "/v1/crypto/sync" && req.method === "POST") {
      const body = await readJson<{
        book_id: string;
        tax_year: number;
        source?: string;
        sources?: string[];
        csv?: string;
        wallet_address?: string;
      }>(req);
      const user_id =
        typeof req.headers["x-books-user-id"] === "string"
          ? req.headers["x-books-user-id"]
          : undefined;
      const user_jwt =
        typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
      try {
        const result = await syncCrypto({ ...body, user_id, user_jwt });
        if (result.invalid?.length) {
          json(res, 400, {
            error: "INVALID_SYNC_SOURCES",
            invalid: result.invalid,
            unavailable: result.unavailable,
            registered: defaultAdapterRegistry.enabledSourceIds(),
          });
          return;
        }
        if (!result.sources.length && result.unavailable?.length) {
          json(res, 501, {
            error: "SYNC_SOURCE_UNAVAILABLE",
            unavailable: result.unavailable,
            registered: defaultAdapterRegistry.listSources(),
          });
          return;
        }
        json(res, 200, result);
      } catch (err) {
        json(res, 502, { error: err instanceof Error ? err.message : "sync_failed" });
      }
      return;
    }

    if (url.pathname === "/v1/crypto/timeline" && req.method === "GET") {
      const tax_year = parseInt(url.searchParams.get("tax_year") ?? "2024", 10);
      const book_id = url.searchParams.get("book_id") ?? "00000000-0000-0000-0000-000000000002";
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      let txs = defaultCryptoStore.listByBookYear(book_id, tax_year);
      if (url.searchParams.get("fixture") === "1") {
        txs = parseExchangeCsv(
          "time,type,asset,amount,eur\n2024-06-15T14:32:00Z,sell,BTC,-0.01,450.00",
          tax_year
        );
      }
      if (from) txs = txs.filter((t) => t.occurred_at >= from);
      if (to) txs = txs.filter((t) => t.occurred_at <= to);
      const ctx = agentCtx({
        book_id: url.searchParams.get("book_id") ?? undefined,
        tax_year,
      });
      const lock = requireBookYearUnlocked(ctx.entitlements, ctx.book_id, tax_year, ctx.tax_domain);
      if (lock) {
        json(res, 402, { error: lock, draft_timeline_allowed: false });
        return;
      }
      json(res, 200, { timeline: buildMinuteTimeline(txs, tax_year, ctx.tax_domain) });
      return;
    }

    if (url.pathname === "/v1/agent/tools" && req.method === "GET") {
      json(res, 200, { tools: (await import("./agent/tools.js")).AGENT_TOOLS });
      return;
    }

    json(res, 404, { error: "not_found" });
  };
}
