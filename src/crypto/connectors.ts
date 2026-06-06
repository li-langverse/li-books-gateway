import type { CryptoTransaction, CryptoSyncSource } from "./types.js";
import { parseExchangeCsv } from "./csv.js";
import { defaultCryptoStore, type CryptoStore } from "./store.js";
import {
  defaultAdapterRegistry,
  type CryptoAdapterRegistry,
} from "./adapters/registry.js";
import type { AdapterSyncContext } from "./adapters/types.js";
import { defaultSyncStore, type SyncStore } from "./sync-store.js";

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
  user_id?: string;
  user_jwt?: string;
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
    user_id: input.user_id,
    user_jwt: input.user_jwt,
    org_id: input.org_id,
  };
}

export async function syncCrypto(
  input: CryptoSyncInput,
  store: CryptoStore = defaultCryptoStore,
  registry: CryptoAdapterRegistry = defaultAdapterRegistry,
  fetchFn?: typeof globalThis.fetch,
  syncStore: SyncStore = defaultSyncStore
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

  const allTxs: CryptoTransaction[] = [];
  const synced: string[] = [];

  for (const sourceId of valid) {
    const ctx = toAdapterContext(input, fetchFn);
    if (sourceId === "eth_wallet" && input.wallet_address && input.book_id) {
      store.registerWallet(input.book_id, input.wallet_address);
    }

    const userId = input.user_id ?? "anonymous";
    const prior = syncStore.getCursor(input.book_id, userId, sourceId);
    if (prior?.last_sync_at) {
      ctx.since = prior.last_sync_at;
    }

    const { txs, source } = await registry.syncSource(sourceId, ctx, input.csv);
    allTxs.push(...txs);
    synced.push(source);

    if (input.user_id) {
      const latestAt =
        txs.length > 0
          ? txs.reduce((max, t) => (t.occurred_at > max ? t.occurred_at : max), txs[0]!.occurred_at)
          : new Date().toISOString();
      syncStore.setCursor({
        book_id: input.book_id,
        user_id: input.user_id,
        source: sourceId,
        last_sync_at: latestAt,
        cursor_payload: { incremental: Boolean(prior), tx_count: txs.length },
      });
      syncStore.appendRaw({
        book_id: input.book_id,
        user_id: input.user_id,
        source: sourceId,
        sync_cursor: prior?.last_sync_at,
        response_body: { tx_count: txs.length, sources: [source] },
      });
    }
  }

  const stored = store.importMany(input.book_id, allTxs);
  return {
    imported: stored.length,
    needs_clarification: stored.filter((t) => t.needs_clarification).length,
    sources: synced,
    ...(unavailable.length ? { unavailable } : {}),
  };
}
