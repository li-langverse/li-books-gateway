import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bases = [
  ["EXP_RENT", "Miete Geschaeftsraeume", 100, 19, "KZ66"],
  ["EXP_UTIL", "Strom/Gas/Wasser", 100, 19, "KZ66"],
  ["EXP_PHONE", "Telefon/Internet", 100, 19, "KZ66"],
  ["EXP_INSUR", "Versicherungen", 100, 19, "KZ66"],
  ["EXP_ADV", "Werbung/Marketing", 100, 19, "KZ66"],
  ["EXP_TRAINING", "Fortbildung", 100, 19, "KZ66"],
  ["EXP_LEGAL", "Rechts-/Steuerberatung", 100, 19, "KZ66"],
  ["EXP_BANK", "Kontofuehrung", 100, 19, "KZ66"],
  ["EXP_POST", "Porto/Versand", 100, 19, "KZ66"],
  ["EXP_TOOLS", "Werkzeuge GWG", 100, 19, "KZ66"],
  ["EXP_FUEL", "Kraftstoff", 100, 19, "KZ66"],
  ["EXP_PARK", "Parkgebuehren", 100, 19, "KZ66"],
  ["EXP_HOTEL", "Uebernachtung", 100, 19, "KZ66"],
  ["EXP_MEAL", "Verpflegung Dienstreise", 100, 19, "KZ66"],
  ["EXP_GIFTS", "Geschenke", 100, 19, "KZ66"],
  ["EXP_MEMBERSHIP", "Mitgliedschaften", 100, 19, "KZ66"],
  ["EXP_HOSTING", "Hosting/Server", 100, 19, "KZ66"],
  ["EXP_DOMAIN", "Domains", 100, 19, "KZ66"],
  ["EXP_ADS", "Online-Werbung", 100, 19, "KZ66"],
  ["EXP_CONTRACTOR", "Freelancer/Einzelauftrag", 100, 19, "KZ66"],
  ["EXP_EQUIP", "Betriebsausstattung", 100, 19, "KZ66"],
  ["EXP_MAINT", "Instandhaltung", 100, 19, "KZ66"],
  ["EXP_CLEAN", "Reinigung", 100, 19, "KZ66"],
  ["EXP_BOOKS", "Fachliteratur", 100, 19, "KZ66"],
  ["EXP_SUBS", "Abonnements", 100, 19, "KZ66"],
  ["EXP_CLOUD", "Cloud-Dienste", 100, 19, "KZ66"],
  ["EXP_AI", "KI/API Tokens", 100, 19, "KZ66"],
  ["EXP_LICENSE", "Lizenzen", 100, 19, "KZ66"],
  ["EXP_COURIER", "Kurierdienst", 100, 19, "KZ66"],
  ["EXP_OFFICE_7", "Buerobedarf 7%", 100, 7, "KZ66"],
  ["EXP_FOOD_7", "Lebensmittel 7%", 100, 7, "KZ66"],
  ["EXP_VEHICLE", "Kfz-Kosten", 100, 19, "KZ66"],
  ["EXP_LEASING", "Leasing", 100, 19, "KZ66"],
  ["EXP_DEPR", "Abschreibung AfA", 100, 19, "KZ66"],
  ["EXP_ENTertain", "Bewirtung 100% intern", 100, 19, "KZ66"],
  ["EXP_TELEWORK", "Homeoffice Pauschale", 100, 19, "KZ66"],
  ["EXP_HARDWARE", "Hardware", 100, 19, "KZ66"],
  ["EXP_SOFTWARE_MAINT", "Software-Wartung", 100, 19, "KZ66"],
  ["EXP_CONFERENCE", "Konferenz/Ticket", 100, 19, "KZ66"],
  ["EXP_COWORK", "Coworking", 100, 19, "KZ66"],
  ["EXP_PRINT", "Druck/Copy", 100, 19, "KZ66"],
  ["EXP_SECURITY", "IT-Sicherheit", 100, 19, "KZ66"],
  ["EXP_MEDICAL", "Arbeitsmedizin", 100, 19, "KZ66"],
  ["EXP_DONATION", "Spenden", 100, 0, "KZ66"],
];

const rev = [
  ["REV_19", "Umsatz 19%", null, 19, "KZ81"],
  ["REV_7", "Umsatz 7%", null, 7, "KZ81"],
  ["REV_0", "Steuerfreier Umsatz", null, 0, "KZ86"],
  ["REV_EXPORT", "Ausfuhrlieferung", null, 0, "KZ43"],
  ["REV_EU", "Innergemeinschaftliche Lieferung", null, 0, "KZ42"],
  ["REV_SERVICE_EU", "EU-Dienstleistung", null, 0, "KZ21"],
  ["REV_REVERSE", "Reverse Charge Erloes", null, 19, "KZ84"],
  ["REV_SAAS", "SaaS Abonnement", null, 19, "KZ81"],
  ["REV_CONSULT", "Beratung", null, 19, "KZ81"],
  ["REV_LICENSE", "Lizenzumsatz", null, 19, "KZ81"],
];

const inc = Array.from({ length: 20 }, (_, i) => [
  `INC_${i + 1}`,
  `Einkommen Kategorie ${i + 1}`,
  null,
  null,
  null,
]);

const stub = [
  ["EXP_OFFICE", "Bürobedarf", 100, 19, "KZ66"],
  ["EXP_SOFTWARE", "Software & SaaS", 100, 19, "KZ66"],
  ["EXP_BEWIRTUNG_70", "Bewirtung (70%)", 70, 19, "KZ66"],
  ["EXP_TRAVEL", "Reisekosten", 100, 19, "KZ66"],
  ["EXP_KLEINUNTERNEHMER", "Kleinunternehmer Ausgabe", 100, 0, null],
  ["REV_STANDARD_19", "Umsatz 19% USt", null, 19, "KZ81"],
  ["REV_KLEINUNTERNEHMER", "Kleinunternehmer Umsatz", null, 0, "KZ86"],
  ["INC_SALARY", "Gehalt / Einkommen", null, null, null],
];

function row(code, name, domains, ded, vat, ustva) {
  const dedS = ded == null ? "NULL" : String(ded);
  const vatS = vat == null ? "NULL" : String(vat);
  const ustvaS = ustva == null ? "NULL" : `'${ustva}'`;
  return `  ('${code}', '${name}', ARRAY[${domains}], ${dedS}, ${vatS}, ${ustvaS})`;
}

const rows = [];
for (const [code, name, ded, vat, ustva] of stub) {
  const dom = code.startsWith("INC_") ? "'income'" : code.startsWith("REV_KLEIN") || code === "EXP_KLEINUNTERNEHMER" ? "'freelance'" : "'freelance', 'company'";
  rows.push(row(code, name, dom, ded, vat, ustva));
}
for (const [code, name, ded, vat, ustva] of bases) {
  rows.push(row(code, name, "'freelance', 'company'", ded, vat, ustva));
}
for (const [code, name, ded, vat, ustva] of rev) {
  rows.push(row(code, name, "'freelance', 'company'", ded, vat, ustva));
}
for (const [code, name] of inc) {
  rows.push(row(code, name, "'income'", null, null, null));
}

const out = `-- WP-210: DE tax category catalog (${rows.length} rows)\nINSERT INTO de_tax_category (code, name, tax_domains, deductibility_pct, vat_rate, ustva_line)\nVALUES\n${rows.join(",\n")}\nON CONFLICT (code) DO NOTHING;\n`;

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "li", "lidb", "seeds", "de_tax_category.sql");
writeFileSync(target, out);
console.log("wrote", rows.length, "rows to", target);
