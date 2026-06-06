import type { FetchFn } from "../http-client.js";
import type { CryptoTransaction } from "../types.js";

/** Shared context passed to exchange and wallet adapters during sync. */
export type AdapterSyncContext = {
  book_id: string;
  tax_year: number;
  fetchFn?: FetchFn;
  csv?: string;
  wallet_address?: string;
  /** Authenticated klaut.pro user — secrets resolved from secret/tenants/{user_id}/ */
  user_id?: string;
  user_jwt?: string;
  org_id?: string;
  /** Incremental sync — fetch only rows after this ISO timestamp when supported. */
  since?: string;
};

export interface CryptoExchangeAdapter {
  readonly id: string;
  /** When false the adapter is registered for discovery but not callable. */
  readonly enabled: boolean;
  /** Future adapter stub — listed in registry docs, not yet implemented. */
  readonly planned?: boolean;
  syncTrades(ctx: AdapterSyncContext): Promise<CryptoTransaction[]>;
  syncDepositsWithdrawals(ctx: AdapterSyncContext): Promise<CryptoTransaction[]>;
  normalizeTx(raw: unknown, tax_year: number): CryptoTransaction | null;
  syncAll(ctx: AdapterSyncContext): Promise<CryptoTransaction[]>;
}

export interface CryptoWalletAdapter {
  readonly id: string;
  readonly chain: string;
  readonly enabled: boolean;
  readonly planned?: boolean;
  syncAddress(ctx: AdapterSyncContext): Promise<CryptoTransaction[]>;
  normalizeTx(raw: unknown, tax_year: number): CryptoTransaction | null;
}

export type SourceValidation = {
  valid: string[];
  invalid: string[];
  unavailable: string[];
};
