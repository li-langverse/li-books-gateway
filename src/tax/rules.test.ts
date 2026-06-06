import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { filterCategoriesForBook, type TaxCategory } from "./rules.js";

const sample: TaxCategory[] = [
  { code: "EXP_OFFICE", name: "Büro", tax_domains: ["freelance", "company"], deductibility_pct: 100, vat_rate: 19, ustva_line: "KZ66" },
  { code: "REV_STANDARD_19", name: "Umsatz 19", tax_domains: ["freelance", "company"], deductibility_pct: null, vat_rate: 19, ustva_line: "KZ81" },
  { code: "REV_KLEINUNTERNEHMER", name: "KU Umsatz", tax_domains: ["freelance"], deductibility_pct: null, vat_rate: 0, ustva_line: "KZ86" },
  { code: "INC_SALARY", name: "Gehalt", tax_domains: ["income"], deductibility_pct: null, vat_rate: null, ustva_line: null },
];

describe("tax rules engine", () => {
  it("filters by book tax domain", () => {
    const f = filterCategoriesForBook(sample, "freelance", false);
    assert.ok(f.some((c) => c.code === "EXP_OFFICE"));
    assert.ok(!f.some((c) => c.code === "INC_SALARY"));
  });

  it("hides standard VAT revenue for Kleinunternehmer", () => {
    const f = filterCategoriesForBook(sample, "freelance", true);
    assert.ok(!f.some((c) => c.code === "REV_STANDARD_19"));
    assert.ok(f.some((c) => c.code === "REV_KLEINUNTERNEHMER"));
  });
});

describe("de_tax_category seed", () => {
  it("has at least 80 category rows", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "li", "lidb", "seeds");
    const path = join(root, "de_tax_category.sql");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = readFileSync(join("C:", "Users", "Julian", "Documents", "Programming", "li", "lidb", "seeds", "de_tax_category.sql"), "utf8");
    }
    const count = (text.match(/\('\w+/g) ?? []).length;
    assert.ok(count >= 80, `expected >= 80 categories, got ${count}`);
  });
});
