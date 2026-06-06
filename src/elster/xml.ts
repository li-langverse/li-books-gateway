import type { LedgerStore } from "../ledger/store.js";
import { summarizePeriod } from "../ledger/journal.js";

export type UstvaSummary = {
  period_start: string;
  period_end: string;
  kz81: number;
  kz86: number;
  kz66: number;
};

export function buildUstvaSummary(
  store: LedgerStore,
  bookId: string,
  periodStart: string,
  periodEnd: string
): UstvaSummary {
  const { revenue_total, expense_total } = summarizePeriod(store, bookId, periodStart, periodEnd);
  return {
    period_start: periodStart,
    period_end: periodEnd,
    kz81: revenue_total,
    kz86: 0,
    kz66: expense_total,
  };
}

/** M1: UStVA XML (simplified Elster-prep structure for golden tests) */
export function generateUstvaXml(summary: UstvaSummary, taxNumber = "12345678901"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
  <TransferHeader>
    <Verfahren>UStVA</Verfahren>
    <DatenArt>UStVA</DatenArt>
    <SteuerNummer>${taxNumber}</SteuerNummer>
    <Zeitraum>${summary.period_start}/${summary.period_end}</Zeitraum>
  </TransferHeader>
  <DatenTeil>
    <Nutzdatenblock>
      <Umsatzsteuervoranmeldung>
        <Kz81>${summary.kz81.toFixed(2)}</Kz81>
        <Kz86>${summary.kz86.toFixed(2)}</Kz86>
        <Kz66>${summary.kz66.toFixed(2)}</Kz66>
      </Umsatzsteuervoranmeldung>
    </Nutzdatenblock>
  </DatenTeil>
</Elster>`;
}

/** M1: EÜR XML summary from period rollups */
export function generateEurXml(
  store: LedgerStore,
  bookId: string,
  periodStart: string,
  periodEnd: string
): string {
  const { expense_total, revenue_total } = summarizePeriod(store, bookId, periodStart, periodEnd);
  const profit = Math.round((revenue_total - expense_total) * 100) / 100;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
  <TransferHeader>
    <Verfahren>EUR</Verfahren>
    <DatenArt>EUR</DatenArt>
    <Zeitraum>${periodStart}/${periodEnd}</Zeitraum>
  </TransferHeader>
  <DatenTeil>
    <EinnahmenUeberschussRechnung>
      <Betriebseinnahmen>${revenue_total.toFixed(2)}</Betriebseinnahmen>
      <Betriebsausgaben>${expense_total.toFixed(2)}</Betriebsausgaben>
      <Gewinn>${profit.toFixed(2)}</Gewinn>
    </EinnahmenUeberschussRechnung>
  </DatenTeil>
</Elster>`;
}

/** M2: validate-only — basic XML well-formedness + required tags */
export function validateElsterXml(xml: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!xml.includes('<?xml version="1.0"')) errors.push("missing_xml_declaration");
  if (!xml.includes("<Elster")) errors.push("missing_elster_root");
  if (!xml.includes("</Elster>")) errors.push("missing_elster_close");
  return { valid: errors.length === 0, errors };
}

/** M3/M4: authenticated submit — blocked without Elster cert */
export type ElsterSubmitResult =
  | { status: "blocked"; reason: "ELSTER_CERT_REQUIRED"; todo: string }
  | { status: "submitted"; transfer_ticket: string };

export function submitElster(_xml: string): ElsterSubmitResult {
  return {
    status: "blocked",
    reason: "ELSTER_CERT_REQUIRED",
    todo: "WP-230 M3: wire ERiC SDK + Steuerberater gate when Vault cert available",
  };
}
