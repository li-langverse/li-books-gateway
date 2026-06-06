import type { CryptoWalletAdapter, AdapterSyncContext } from "./types.js";
import type { CryptoTransaction } from "../types.js";
import { resolveEthWalletAddress } from "../../secrets/credentials.js";

/** MVP: ETH mainnet wallet sync stub — RPC integration in follow-up WP. */
export const ethWalletAdapter: CryptoWalletAdapter = {
  id: "eth_wallet",
  chain: "ethereum",
  enabled: true,

  async syncAddress(ctx: AdapterSyncContext): Promise<CryptoTransaction[]> {
    const address = await resolveEthWalletAddress(ctx, ctx.wallet_address);
    if (!address) return [];
    void ctx.tax_year;
    // Live RPC parsing wired via ETH_RPC_URL in a future wallet module.
    return [];
  },

  normalizeTx(_raw: unknown, _tax_year: number): CryptoTransaction | null {
    return null;
  },
};
