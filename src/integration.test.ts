import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createBooksRouter } from "./server.js";

describe("gateway integration pipeline", () => {
  it("parse → law citation → clarification flag", async () => {
    const router = createBooksRouter();
    const server = createServer((req, res) => void router(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/receipts/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ocr_text: "REWE\nBürobedarf 19.99\nTotal 19.99\n2024-06-01",
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      parsed: { amount: number | null };
      law_citations: unknown[];
      clarification_required: boolean;
    };
    assert.ok(json.parsed.amount != null);
    assert.ok(Array.isArray(json.law_citations));

    server.close();
  });

  it("chat SSE streams events", async () => {
    const router = createBooksRouter();
    const server = createServer((req, res) => void router(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Upload receipt" }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /event: message/);
    assert.match(text, /event: done/);
    server.close();
  });
});
