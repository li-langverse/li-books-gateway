import type { CryptoExchangeAdapter } from "./types.js";
import type { CryptoTransaction } from "../types.js";

function plannedExchange(id: string, doc: string): CryptoExchangeAdapter {
  return {
    id,
    enabled: false,
    planned: true,
    async syncTrades(): Promise<CryptoTransaction[]> {
      throw new Error(`${id} adapter not implemented — ${doc}`);
    },
    async syncDepositsWithdrawals(): Promise<CryptoTransaction[]> {
      throw new Error(`${id} adapter not implemented — ${doc}`);
    },
    normalizeTx(): CryptoTransaction | null {
      return null;
    },
    async syncAll(): Promise<CryptoTransaction[]> {
      throw new Error(`${id} adapter not implemented — ${doc}`);
    },
  };
}

/** Future exchange adapters — registered for API discovery, not enabled in MVP. */
export const krakenStub = plannedExchange(
  "kraken",
  "implement CryptoExchangeAdapter in adapters/kraken.adapter.ts"
);
export const coinbaseStub = plannedExchange(
  "coinbase",
  "implement CryptoExchangeAdapter in adapters/coinbase.adapter.ts"
);
export const bybitStub = plannedExchange(
  "bybit",
  "implement CryptoExchangeAdapter in adapters/bybit.adapter.ts"
);
