# li-books-gateway

Agentic German bookkeeping gateway for the li platform.

## Role

- Chat API with SSE streaming (`POST /v1/chat/messages`)
- Receipt parse pipeline (ported from `documenting-receipts`)
- Clarification FSM — never auto-post on low confidence
- Law RAG integration (`POST /v1/law/search`)
- TTS metering via `li-api-kit`

## Dev

```bash
export OLLAMA_HOST=http://127.0.0.1:11434
export TTS_STUB=1
npm install
npm test
```

## Work packages

See `klaut-li-books` and `klaut.pro/docs/plans/li-books-agentic-bookkeeping-plan.md`.
