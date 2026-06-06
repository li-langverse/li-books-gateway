import type { IncomingMessage, ServerResponse } from "node:http";
import { parseReceiptText } from "./parse/parseReceiptText.js";
import { applyCategorize } from "./clarify/fsm.js";
import { handleLawSearch } from "./law-search.js";

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function handleChatMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }
  const body = await readJson<{ message: string; book_id?: string }>(req);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseWrite(res, "message", { role: "assistant", content: `Echo: ${body.message}` });
  sseWrite(res, "done", { ok: true });
  res.end();
}

export async function handleReceiptParse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{ ocr_text: string; ocr_provider?: string }>(req);
  const parsed = parseReceiptText(body.ocr_text, {
    ocrProvider: body.ocr_provider as "tesseract" | "deepseek2" | undefined,
  });
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
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      parsed,
      confidence,
      law_citations: lawHits,
      clarification_required: fsm.requiresClarification,
      status: fsm.nextStatus,
    })
  );
}

export function createBooksRouter() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, product: "li-books" }));
      return;
    }
    if (url.pathname === "/v1/chat/messages") {
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hits }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  };
}
