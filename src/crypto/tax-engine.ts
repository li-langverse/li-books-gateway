import type { CryptoTransaction, CryptoTaxMinute, TaxDomain } from "./types.js";

/** §23 ESt private sales (1-year holding); staking as income. Simplified v1 rates. */
const ESTG23_RATE = 0.45;
const STAKING_INCOME_RATE = 0.45;

export function estimateTaxEur(taxable_gain_eur: number, tx_type: CryptoTransaction["tx_type"], domain: TaxDomain): number {
  if (taxable_gain_eur <= 0) return 0;
  const base = domain === "company" ? 0.15 : ESTG23_RATE;
  if (tx_type === "staking_reward") return Math.round(taxable_gain_eur * STAKING_INCOME_RATE * 100) / 100;
  return Math.round(taxable_gain_eur * base * 100) / 100;
}

export function buildMinuteTimeline(
  txs: CryptoTransaction[],
  tax_year: number,
  domain: TaxDomain = "freelance"
): CryptoTaxMinute[] {
  const byMinute = new Map<string, CryptoTaxMinute>();
  let cumulativePnl = 0;

  for (const tx of txs) {
    if (!tx.occurred_at.startsWith(String(tax_year))) continue;
    const minute = tx.occurred_at.slice(0, 16) + ":00Z";
    const pnl = tx.fiat_amount_eur ?? 0;
    cumulativePnl += pnl;
    const taxable = tx.tx_type === "sell" || tx.tx_type === "staking_reward" ? Math.max(0, pnl) : 0;
    const prev = byMinute.get(minute) ?? {
      minute_ts: minute,
      realized_pnl_eur: 0,
      taxable_gain_eur: 0,
      estimated_tax_eur: 0,
      tx_count: 0,
      spike_flag: false,
    };
    prev.realized_pnl_eur = Math.round(cumulativePnl * 100) / 100;
    prev.taxable_gain_eur = Math.round((prev.taxable_gain_eur + taxable) * 100) / 100;
    prev.estimated_tax_eur = estimateTaxEur(prev.taxable_gain_eur, tx.tx_type, domain);
    prev.tx_count += 1;
    prev.spike_flag = prev.estimated_tax_eur >= 500 || Math.abs(pnl) >= 1000;
    byMinute.set(minute, prev);
  }

  return [...byMinute.values()].sort((a, b) => a.minute_ts.localeCompare(b.minute_ts));
}

export function explainMinuteSpike(minute: CryptoTaxMinute, txs: CryptoTransaction[]): string {
  const atMinute = txs.filter((t) => t.occurred_at.startsWith(minute.minute_ts.slice(0, 16)));
  if (minute.spike_flag) {
    const types = [...new Set(atMinute.map((t) => t.tx_type))].join(", ");
    return `Tax load spike at ${minute.minute_ts}: estimated €${minute.estimated_tax_eur} tax on €${minute.taxable_gain_eur} taxable gain (${types}). Check §23 EStG holding period or classify unknown transfers.`;
  }
  return `No spike at ${minute.minute_ts}; cumulative P&L €${minute.realized_pnl_eur}.`;
}
