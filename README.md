# li-books-gateway

Agentic German bookkeeping gateway for the li platform.

## Role

- Chat API with SSE streaming (`POST /v1/chat/messages`)
- Receipt parse pipeline (ported from `documenting-receipts`)
- Clarification FSM — never auto-post on low confidence
- Law RAG integration (`POST /v1/law/search`)
- Crypto tax sync via pluggable exchange/wallet adapters
- TTS metering via `li-api-kit`

## Dev

```bash
export OLLAMA_HOST=http://127.0.0.1:11434
export TTS_STUB=1
cp .env.example .env   # add Binance/OKX keys for live sync tests
npm install
npm test
```

## Crypto sync (MVP)

**Enabled sources:** `binance`, `okx`, `csv`, `eth_wallet`

```bash
# List registered adapters (enabled + planned stubs)
GET /v1/crypto/sources

# Sync one or more sources
POST /v1/crypto/sync
{
  "book_id": "...",
  "tax_year": 2024,
  "sources": ["binance", "okx"]
}
```

Full timeline export requires per-year unlock (`GET /v1/crypto/timeline`).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `BINANCE_API_KEY`, `BINANCE_API_SECRET` | Binance REST sync |
| `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_PASSPHRASE` | OKX REST sync |
| `CRYPTO_WALLET_ETH`, `ETH_RPC_URL` | ETH wallet (MVP stub) |

See `.env.example` for the full list. Secrets are never logged (redacted in HTTP client errors).

## Adding a new exchange

1. **Implement `CryptoExchangeAdapter`** in `src/crypto/adapters/<name>.adapter.ts`:
   - `syncTrades(ctx)` — fetch fills/trades for `ctx.tax_year`
   - `syncDepositsWithdrawals(ctx)` — deposits + withdrawals
   - `normalizeTx(raw, tax_year)` — map vendor JSON → `CryptoTransaction`
   - `syncAll(ctx)` — default combines trades + flows (override if needed)

2. **Add low-level REST client** in `src/crypto/<name>.ts` (signing, pagination, rate limits via `HttpClient`).

3. **Register** in `src/crypto/adapters/registry.ts`:
   ```typescript
   this.registerExchange(myAdapter);
   ```

4. **Document env vars** in `.env.example` and add mocked integration tests in `src/crypto/crypto.test.ts`.

5. **Optional live test** — gate with `{ skip: !process.env.MY_API_KEY }` describe block.

Planned stubs (`kraken`, `coinbase`, `bybit`) live in `src/crypto/adapters/stubs.ts` — copy one as a template.

## Adding a new wallet chain

1. Implement **`CryptoWalletAdapter`** in `src/crypto/adapters/<chain>.adapter.ts` with `syncAddress(ctx)` and `normalizeTx`.
2. Register via `registry.registerWallet(...)`.
3. Book-level addresses can be stored in lidb `crypto_wallet` (gateway uses in-memory `CryptoStore` in dev).

## Work packages

See `klaut-li-books` and `klaut.pro/docs/plans/li-books-agentic-bookkeeping-plan.md`.
