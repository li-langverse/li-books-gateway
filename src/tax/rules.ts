/** DE tax category rules — domain filter + Kleinunternehmer */

export type TaxDomain = "freelance" | "company" | "income";

export type TaxCategory = {
  code: string;
  name: string;
  tax_domains: TaxDomain[];
  deductibility_pct: number | null;
  vat_rate: number | null;
  ustva_line: string | null;
};

export function filterCategoriesForBook(
  categories: TaxCategory[],
  taxDomain: TaxDomain,
  kleinunternehmer: boolean
): TaxCategory[] {
  return categories.filter((c) => {
    if (!c.tax_domains.includes(taxDomain)) return false;
    if (kleinunternehmer && c.vat_rate != null && c.vat_rate > 0 && c.code.startsWith("REV_")) {
      if (!c.code.includes("KLEINUNTERNEHMER") && c.code !== "REV_KLEINUNTERNEHMER") {
        // prefer Kleinunternehmer revenue categories when flagged
      }
    }
    if (kleinunternehmer && c.code === "REV_STANDARD_19") return false;
    return true;
  });
}

export function effectiveDeductibility(category: TaxCategory): number {
  return category.deductibility_pct ?? 0;
}
