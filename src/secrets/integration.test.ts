import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { issueToken, devHs256Key } from "@li-langverse/li-auth-jwt/jwt";
import { createSecretsHandler, MockVaultStore } from "@li-langverse/li-books-secrets-api";
import { syncCrypto } from "../crypto/connectors.js";
import { CryptoStore } from "../crypto/store.js";
import { CryptoAdapterRegistry } from "../crypto/adapters/registry.js";

const USER = "usr_sync_test_00000000-0000-0000-0000-000000000099";

describe("crypto sync reads user Vault secrets", () => {
  let secretsServer: Server;
  let userJwt: string;

  beforeEach(async () => {
    process.env.BOOKS_JWT_SECRET = "test-secret";
    process.env.VAULT_MOCK = "1";
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;

    const store = new MockVaultStore();
    await store.write(USER, "crypto/binance", {
      api_key: "vault-key",
      api_secret: "vault-secret",
    });

    secretsServer = createServer(createSecretsHandler(store));
    await new Promise<void>((r) => secretsServer.listen(0, r));
    const addr = secretsServer.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    process.env.SECRETS_API_URL = `http://127.0.0.1:${addr.port}`;

    userJwt = issueToken({ sub: USER, role: "authenticated" }, devHs256Key());
  });

  afterEach(() => {
    secretsServer.close();
  });

  it("uses JWT sub user path for exchange credentials", async () => {
    const registry = new CryptoAdapterRegistry();

    const fetchCalls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const store = new CryptoStore();
    const result = await syncCrypto(
      {
        book_id: "book-1",
        tax_year: 2024,
        sources: ["binance"],
        user_id: USER,
        user_jwt: userJwt,
      },
      store,
      registry,
      mockFetch
    );

    assert.equal(result.imported, 0);
    assert.ok(fetchCalls.some((u) => u.includes("api.binance.com")));
    assert.ok(fetchCalls.some((u) => u.includes("timestamp=")));
  });
});
