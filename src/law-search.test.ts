import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleLawSearch } from "./law-search.js";

describe("POST /v1/law/search handler", () => {
  it("returns Kleinunternehmer citation for UStG query", async () => {
    const hits = await handleLawSearch({
      query: "Kleinunternehmer Umsatzsteuer",
      tax_domain: "freelance",
      limit: 3,
    });
    assert.ok(hits.length > 0);
    assert.ok(
      hits.some((h) => h.excerpt.includes("Kleinunternehmer") || h.section_ref.includes("§19"))
    );
  });
});
