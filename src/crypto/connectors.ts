import type { CryptoTransaction, CryptoSyncSource } from "./types.js";
import { parseExchangeCsv } from "./csv.js";
import { defaultCryptoStore, type CryptoStore } from "./store.js";
import {
  defaultAdapterRegistry,
  type CryptoAdapterRegistry,
} from "./adapters/registry.js";
import type { AdapterSyncContext } from "./adapters/types.js";

export type { CryptoSyncSource } from "./types.js";
export { defaultAdapterRegistry, CryptoAdapterRegistry } from "./adapters/registry.js";
export type { CryptoExchangeAdapter, CryptoWalletAdapter } from "./adapters/types.js";

export type CryptoSyncInput = {
  book_id: string;
  tax_year: number;
  /** Single source (legacy) */
  source?: CryptoSyncSource | string;
  /** Multiple sources (preferred) — validated against adapter registry */
  sources?: string[];
  csv?: string;
  wallet_address?: string;
  exchange_account_id?: string;
  org_id?: string;
};

export type CryptoSyncResult = {
  imported: number;
  needs_clarification: number;
  sources: string[];
  unavailable?: string[];
  invalid?: string[];
};

export { parseExchangeCsv } from "./csv.js";

function resolveSources(input: CryptoSyncInput): string[] {
  if (input.sources?.length) return input.sources;
  if (input.source) return [input.source];
  return [];
}

function toAdapterContext(input: CryptoSyncInput, fetchFn?: typeof globalThis.fetch): AdapterSyncContext {
  return {
    book_id: input.book_id,
    tax_year: input.tax_year,
    fetchFn,
    csv: input.csv,
    wallet_address: input.wallet_address,
    org_id: input.org_id,
  };
}

export async function syncCrypto(
  input: CryptoSyncInput,
  store: CryptoStore = defaultCryptoStore,
  registry: CryptoAdapterRegistry = defaultAdapterRegistry,
  fetchFn?: typeof globalThis.fetch
): Promise<CryptoSyncResult> {
  const requested = resolveSources(input);
  if (!requested.length) {
    return { imported: 0, needs_clarification: 0, sources: [] };
  }

  const { valid, invalid, unavailable } = registry.validateSources(requested);
  if (invalid.length) {
    return {
      imported: 0,
      needs_clarification: 0,
      sources: [],
      invalid,
      unavailable,
    };
  }
  if (!valid.length) {
    return {
      imported: 0,
      needs_clarification: 0,
      sources: [],
      unavailable,
    };
  }

  const ctx = toAdapterContext(input, fetchFn);
  const allTxs: CryptoTransaction[] = [];
  const synced: string[] = [];

  for (const sourceId of valid) {
    if (sourceId === "eth_wallet" && input.wallet_address && input.book_id) {
      store.registerWallet(input.book_id, input.wallet_address);
    }
    const { txs, source } = await registry.syncSource(sourceId, ctx, input.csv);
    allTxs.push(...txs);
    synced.push(source);
  }

  const stored = store.importMany(input.book_id, allTxs);
  return {
    imported: stored.length,
    needs_clarification: stored.filter((t) => t.needs_clarification).length,
    sources: synced,
    ...(unavailable.length ? { unavailable } : {}),
  };
}
