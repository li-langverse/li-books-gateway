import type { CryptoTransaction } from "./types.js";

/** Binance/OKX/generic trade CSV columns (minimal v1) */
export function parseExchangeCsv(csv: string, tax_year: number): CryptoTransaction[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.toLowerCase();
  const txs: CryptoTransaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    if (header.includes("time") && header.includes("type")) {
      const timeIdx = header.split(",").indexOf("time");
      const typeIdx = header.split(",").indexOf("type");
      const assetIdx = header.split(",").indexOf("asset");
      const amountIdx = header.split(",").indexOf("amount");
      const eurIdx = header.split(",").indexOf("eur");
      const occurred_at = cols[timeIdx] ?? `${tax_year}-01-01T00:00:00Z`;
      const tx_type = mapExchangeType(cols[typeIdx] ?? "unknown");
      txs.push({
        id: `csv-${i}`,
        occurred_at,
        asset: cols[assetIdx] ?? "BTC",
        quantity: parseFloat(cols[amountIdx] ?? "0"),
        fiat_amount_eur: eurIdx >= 0 ? parseFloat(cols[eurIdx] ?? "0") : null,
        tx_type,
        needs_clarification: tx_type === "unknown",
        source_type: "csv",
      });
    }
  }
  return txs;
}

function mapExchangeType(raw: string): CryptoTransaction["tx_type"] {
  const t = raw.toLowerCase();
  if (t.includes("buy")) return "buy";
  if (t.includes("sell")) return "sell";
  if (t.includes("stake") || t.includes("reward")) return "staking_reward";
  if (t.includes("fee")) return "fee";
  if (t.includes("deposit")) return "transfer_in";
  if (t.includes("withdraw")) return "transfer_out";
  return "unknown";
}
