export type CryptoTransaction = {
  id: string;
  occurred_at: string;
  asset: string;
  quantity: number;
  fiat_amount_eur: number | null;
  tx_type:
    | "buy"
    | "sell"
    | "transfer_in"
    | "transfer_out"
    | "swap"
    | "staking_reward"
    | "fee"
    | "unknown";
  needs_clarification: boolean;
  source_type: "wallet" | "exchange" | "csv";
};

export type CryptoTaxMinute = {
  minute_ts: string;
  realized_pnl_eur: number;
  taxable_gain_eur: number;
  estimated_tax_eur: number;
  tx_count: number;
  spike_flag: boolean;
};

export type TaxDomain = "freelance" | "company" | "income";
