import type { BinanceCredentials } from "../crypto/binance.js";
import type { OkxCredentials } from "../crypto/okx.js";
import { binanceCredentialsFromEnv } from "../crypto/binance.js";
import { okxCredentialsFromEnv } from "../crypto/okx.js";
import { readUserSecret, secretsApiBaseFromEnv } from "./client.js";

export const CRYPTO_SECRET_NAMES = {
  binance: "crypto/binance",
  okx: "crypto/okx",
  ethWallet: "crypto/wallet/eth",
} as const;

export type CredentialContext = {
  user_id?: string;
  user_jwt?: string;
};

async function loadSecret(
  ctx: CredentialContext,
  name: string
): Promise<Record<string, string> | null> {
  if (!ctx.user_id || !ctx.user_jwt) return null;
  return readUserSecret(name, {
    baseUrl: secretsApiBaseFromEnv(),
    userJwt: ctx.user_jwt,
  });
}

export async function resolveBinanceCredentials(
  ctx: CredentialContext = {}
): Promise<BinanceCredentials | null> {
  const fromVault = await loadSecret(ctx, CRYPTO_SECRET_NAMES.binance);
  if (fromVault?.api_key && fromVault.api_secret) {
    return { apiKey: fromVault.api_key, apiSecret: fromVault.api_secret };
  }
  return binanceCredentialsFromEnv();
}

export async function resolveOkxCredentials(
  ctx: CredentialContext = {}
): Promise<OkxCredentials | null> {
  const fromVault = await loadSecret(ctx, CRYPTO_SECRET_NAMES.okx);
  if (fromVault?.api_key && fromVault.api_secret && fromVault.passphrase) {
    return {
      apiKey: fromVault.api_key,
      apiSecret: fromVault.api_secret,
      passphrase: fromVault.passphrase,
    };
  }
  return okxCredentialsFromEnv();
}

export async function resolveEthWalletAddress(
  ctx: CredentialContext = {},
  fallback?: string
): Promise<string | null> {
  const fromVault = await loadSecret(ctx, CRYPTO_SECRET_NAMES.ethWallet);
  if (fromVault?.address?.trim()) return fromVault.address.trim();
  return fallback?.trim() || process.env.CRYPTO_WALLET_ETH?.trim() || null;
}
