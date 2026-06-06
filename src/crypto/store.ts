import { randomUUID } from "node:crypto";
import type { CryptoTransaction } from "./types.js";

/** In-memory crypto ledger for dev/tests; mirrors lidb `crypto_transaction` */
export class CryptoStore {
  readonly transactions = new Map<string, CryptoTransaction>();
  readonly wallets = new Map<string, { book_id: string; chain: string; address: string }>();

  key(book_id: string, tx_id: string): string {
    return `${book_id}:${tx_id}`;
  }

  upsert(book_id: string, tx: CryptoTransaction): CryptoTransaction {
    const stored = { ...tx, id: tx.id || randomUUID() };
    this.transactions.set(this.key(book_id, stored.id), stored);
    return stored;
  }

  importMany(book_id: string, txs: CryptoTransaction[]): CryptoTransaction[] {
    return txs.map((t) => this.upsert(book_id, t));
  }

  listForBook(book_id: string, tax_year?: number): CryptoTransaction[] {
    return [...this.transactions.values()]
      .filter((t) => {
        const k = [...this.transactions.entries()].find(([, v]) => v === t)?.[0];
        if (!k?.startsWith(`${book_id}:`)) return false;
        if (tax_year != null && !t.occurred_at.startsWith(String(tax_year))) return false;
        return true;
      })
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  listByBookYear(book_id: string, tax_year: number): CryptoTransaction[] {
    const prefix = `${book_id}:`;
    return [...this.transactions.entries()]
      .filter(([k, t]) => k.startsWith(prefix) && t.occurred_at.startsWith(String(tax_year)))
      .map(([, t]) => t)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  registerWallet(book_id: string, address: string, chain = "ethereum"): void {
    this.wallets.set(`${book_id}:${chain}:${address.toLowerCase()}`, {
      book_id,
      chain,
      address: address.toLowerCase(),
    });
  }

  walletsForBook(book_id: string): string[] {
    return [...this.wallets.values()]
      .filter((w) => w.book_id === book_id)
      .map((w) => w.address);
  }
}

export const defaultCryptoStore = new CryptoStore();
