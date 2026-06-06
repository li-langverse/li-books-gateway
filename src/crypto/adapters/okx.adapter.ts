import type { CryptoExchangeAdapter, AdapterSyncContext } from "./types.js";
import type { CryptoTransaction } from "../types.js";
import {
  parseOkxFill,
  parseOkxDeposit,
  parseOkxWithdrawal,
  syncOkxTrades,
  syncOkxDepositsWithdrawals,
} from "../okx.js";
import { resolveOkxCredentials } from "../../secrets/credentials.js";

export const okxAdapter: CryptoExchangeAdapter = {
  id: "okx",
  enabled: true,

  async syncTrades(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const creds = await resolveOkxCredentials(ctx);
    if (!creds) throw new Error("OKX credentials required (Settings → Secrets or OKX_* env)");
    return syncOkxTrades(creds, ctx.tax_year, ctx.fetchFn);
  },

  async syncDepositsWithdrawals(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const creds = await resolveOkxCredentials(ctx);
    if (!creds) throw new Error("OKX credentials required (Settings → Secrets or OKX_* env)");
    return syncOkxDepositsWithdrawals(creds, ctx.tax_year, ctx.fetchFn);
  },

  normalizeTx(raw: unknown, tax_year: number): CryptoTransaction | null {
    const row = raw as Record<string, unknown>;
    if (row && typeof row.fillId === "string") {
      return parseOkxFill(raw as Parameters<typeof parseOkxFill>[0], tax_year);
    }
    if (row && typeof row.depId === "string") {
      return parseOkxDeposit(raw as Parameters<typeof parseOkxDeposit>[0], tax_year);
    }
    if (row && typeof row.wdId === "string") {
      return parseOkxWithdrawal(raw as Parameters<typeof parseOkxWithdrawal>[0], tax_year);
    }
    return null;
  },

  async syncAll(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const [trades, flows] = await Promise.all([
      this.syncTrades(ctx),
      this.syncDepositsWithdrawals(ctx),
    ]);
    return [...trades, ...flows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  },
};
