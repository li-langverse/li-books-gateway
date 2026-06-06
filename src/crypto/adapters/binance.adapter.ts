import type { CryptoExchangeAdapter, AdapterSyncContext } from "./types.js";
import type { CryptoTransaction } from "../types.js";
import {
  parseBinanceTrade,
  parseBinanceDeposit,
  parseBinanceWithdrawal,
  syncBinanceTrades,
  syncBinanceDepositsWithdrawals,
} from "../binance.js";
import { resolveBinanceCredentials } from "../../secrets/credentials.js";

export const binanceAdapter: CryptoExchangeAdapter = {
  id: "binance",
  enabled: true,

  async syncTrades(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const creds = await resolveBinanceCredentials(ctx);
    if (!creds) throw new Error("Binance credentials required (Settings → Secrets or BINANCE_* env)");
    return syncBinanceTrades(creds, ctx.tax_year, ctx.fetchFn);
  },

  async syncDepositsWithdrawals(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const creds = await resolveBinanceCredentials(ctx);
    if (!creds) throw new Error("Binance credentials required (Settings → Secrets or BINANCE_* env)");
    return syncBinanceDepositsWithdrawals(creds, ctx.tax_year, ctx.fetchFn);
  },

  normalizeTx(raw: unknown, tax_year: number): CryptoTransaction | null {
    const row = raw as Record<string, unknown>;
    if (row && typeof row.symbol === "string" && typeof row.isBuyer === "boolean") {
      return parseBinanceTrade(raw as Parameters<typeof parseBinanceTrade>[0], tax_year);
    }
    if (row && typeof row.insertTime === "number") {
      return parseBinanceDeposit(raw as Parameters<typeof parseBinanceDeposit>[0], tax_year);
    }
    if (row && typeof row.applyTime === "string") {
      return parseBinanceWithdrawal(raw as Parameters<typeof parseBinanceWithdrawal>[0], tax_year);
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
