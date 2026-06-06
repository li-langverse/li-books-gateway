import type { IncomingMessage, ServerResponse } from "node:http";
import { ingestFixturesDir, searchChunks, defaultFixturesDir } from "@li-langverse/li-books-law-ingest/ingest.js";

export type LawSearchRequest = {
  query: string;
  tax_domain?: "freelance" | "company" | "income";
  limit?: number;
};

export type LawSearchHit = {
  section_ref: string;
  heading: string | null;
  excerpt: string;
  score: number;
  tax_domains: string[];
};

let cachedChunks: Awaited<ReturnType<typeof ingestFixturesDir>> | null = null;

async function loadChunks() {
  if (!cachedChunks) {
    cachedChunks = await ingestFixturesDir(defaultFixturesDir());
  }
  return cachedChunks.flatMap((r) => r.chunks);
}

export async function handleLawSearch(body: LawSearchRequest): Promise<LawSearchHit[]> {
  const chunks = await loadChunks();
  const hits = await searchChunks(chunks, body.query, body.tax_domain);
  const limit = body.limit ?? 5;
  return hits.slice(0, limit).map((h) => ({
    section_ref: h.chunk.sectionRef,
    heading: h.chunk.heading,
    excerpt: h.chunk.body.slice(0, 240),
    score: h.score,
    tax_domains: h.chunk.taxDomains,
  }));
}

export async function lawSearchHttpHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as LawSearchRequest;
  const hits = await handleLawSearch(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ hits }));
}
