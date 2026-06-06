import type { CryptoExchangeAdapter, CryptoWalletAdapter, AdapterSyncContext, SourceValidation } from "./types.js";
import type { CryptoTransaction } from "../types.js";
import { parseExchangeCsv } from "../csv.js";
import { binanceAdapter } from "./binance.adapter.js";
import { okxAdapter } from "./okx.adapter.js";
import { ethWalletAdapter } from "./eth.adapter.js";
import { krakenStub, coinbaseStub, bybitStub } from "./stubs.js";

export type SyncSourceKind = "exchange" | "wallet" | "csv";

export type RegisteredSource = {
  id: string;
  kind: SyncSourceKind;
  enabled: boolean;
  planned?: boolean;
};

const CSV_SOURCE = "csv";

export class CryptoAdapterRegistry {
  readonly exchanges = new Map<string, CryptoExchangeAdapter>();
  readonly wallets = new Map<string, CryptoWalletAdapter>();

  constructor() {
    this.registerExchange(binanceAdapter);
    this.registerExchange(okxAdapter);
    this.registerExchange(krakenStub);
    this.registerExchange(coinbaseStub);
    this.registerExchange(bybitStub);
    this.registerWallet(ethWalletAdapter);
  }

  registerExchange(adapter: CryptoExchangeAdapter): void {
    this.exchanges.set(adapter.id, adapter);
  }

  registerWallet(adapter: CryptoWalletAdapter): void {
    this.wallets.set(adapter.id, adapter);
  }

  listSources(): RegisteredSource[] {
    const out: RegisteredSource[] = [
      { id: CSV_SOURCE, kind: "csv", enabled: true },
    ];
    for (const a of this.exchanges.values()) {
      out.push({ id: a.id, kind: "exchange", enabled: a.enabled, planned: a.planned });
    }
    for (const w of this.wallets.values()) {
      out.push({ id: w.id, kind: "wallet", enabled: w.enabled, planned: w.planned });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  enabledSourceIds(): string[] {
    return this.listSources().filter((s) => s.enabled).map((s) => s.id);
  }

  validateSources(sources: string[]): SourceValidation {
    const valid: string[] = [];
    const invalid: string[] = [];
    const unavailable: string[] = [];

    for (const id of sources) {
      if (id === CSV_SOURCE) {
        valid.push(id);
        continue;
      }
      const ex = this.exchanges.get(id);
      if (ex) {
        if (ex.enabled) valid.push(id);
        else unavailable.push(id);
        continue;
      }
      const wallet = this.wallets.get(id);
      if (wallet) {
        if (wallet.enabled) valid.push(id);
        else unavailable.push(id);
        continue;
      }
      invalid.push(id);
    }
    return { valid, invalid, unavailable };
  }

  getExchange(id: string): CryptoExchangeAdapter | undefined {
    return this.exchanges.get(id);
  }

  getWallet(id: string): CryptoWalletAdapter | undefined {
    return this.wallets.get(id);
  }

  async syncSource(
    sourceId: string,
    ctx: AdapterSyncContext,
    csv?: string
  ): Promise<{ txs: import("../types.js").CryptoTransaction[]; source: string }> {
    if (sourceId === CSV_SOURCE) {
      return { txs: csv ? parseExchangeCsv(csv, ctx.tax_year) : [], source: CSV_SOURCE };
    }

    const exchange = this.exchanges.get(sourceId);
    if (exchange) {
      if (!exchange.enabled) {
        throw new Error(`Exchange adapter '${sourceId}' is registered but not enabled (planned)`);
      }
      const txs = await exchange.syncAll(ctx);
      return { txs, source: sourceId };
    }

    const wallet = this.wallets.get(sourceId);
    if (wallet) {
      if (!wallet.enabled) {
        throw new Error(`Wallet adapter '${sourceId}' is registered but not enabled (planned)`);
      }
      const txs = await wallet.syncAddress(ctx);
      return { txs, source: sourceId };
    }

    throw new Error(`Unknown sync source: ${sourceId}`);
  }
}

export const defaultAdapterRegistry = new CryptoAdapterRegistry();
