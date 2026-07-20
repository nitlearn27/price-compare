# price-compare — Cloudflare Workers backend (TypeScript)

A full TypeScript port of the Python `backend/` (FastAPI), running on **Cloudflare
Workers** with **Hono** (routing) and **`@langchain/langgraph`** (the agent loop).
It serves the Vite frontend as static assets and exposes the same `/api/*`
contract, so the existing React app works unchanged.

> The Python `backend/` (Render/Docker) is **kept as-is**. This `worker/` is an
> alternative deployment target. Nothing here removes the Render setup.

## Why a rewrite (not "add deps")

Cloudflare **Workers** run JS/TS/WASM in V8 isolates — they cannot run a Python
ASGI app (`uvicorn` + `pydantic-core`/`orjson` native wheels + langgraph). So the
backend was reimplemented in TypeScript. The whole thing bundles to **~490 KiB
gzipped**, well within Workers limits.

## Layout

```
src/
  index.ts            Hono app + CORS + static-asset fallback
  env.ts              Worker bindings (Env)
  lib/config.ts       Settings (parsed from env, ~= pydantic Settings)
  models/schemas.ts   wire types (snake_case — same JSON contract)
  lib/                salesforce, product_search, live_search, cart, otp,
                      refresh, recommendations, gemini, cart_analysis, http
  agents/             aggregator hub + salesforce/flipkart/amazon spokes
  agent/              llm (DeepSeek→OpenRouter), tools + dispatch, graph + ShoppingAgent
  routers/            agent (+SSE stream), chat, products, cart, orders, recommendations, identify
```

Behavioral parity with the Python backend: hub-spoke coverage (`covers_source`
prefix match), ranking + buy-suggestion tiers, the agent guardrails
(`agent_max_steps`, token budget, per-step tool cap, identical-call guard,
tools-off finalize), the checkout money-gate, DeepSeek→OpenRouter fallback, and
the OTP short-circuit.

### Cross-turn state

The Python `MemorySaver` checkpointer has no Workers equivalent (isolates are
ephemeral). Instead, when `thread_id` is present and a **KV** namespace is bound,
`ShoppingAgent` persists `{messages, cart}` to KV keyed by `thread_id` (TTL 1 day)
— same "cart survives across turns" behavior. Without KV it runs stateless.

## Develop

```bash
cd worker
pnpm install
cp .dev.vars.example .dev.vars     # fill in secrets
# build the frontend so the static assets exist:
(cd ../frontend && pnpm install && pnpm build)
pnpm dev                            # wrangler dev → http://localhost:8787
```

`pnpm typecheck` · `pnpm test` (vitest — the agent graph is covered with a mocked fetch).

## Deploy

```bash
wrangler login                       # authenticate to your Cloudflare account

# 1. Build the frontend (served as static assets from ../frontend/dist)
(cd ../frontend && pnpm build)

# 2. Upload secrets (reads them from ../.env; values never printed or written to disk)
./scripts/put-secrets.sh
#   sets: SF_TOKEN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET,
#         DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY
#   (SF_TOKEN_URL is a secret — it carries your org's My Domain, matching render.yaml)

# 3. (optional) enable cross-turn persistence
wrangler kv namespace create AGENT_STATE
#   → paste the printed id into the kv_namespaces block in wrangler.jsonc

# 4. Deploy
wrangler deploy
```

> Non-secret config (models, service URLs, guardrail numbers) lives in
> `wrangler.jsonc` `vars` and is safe to commit. Only the six secrets above (plus
> optional `LANGCHAIN_API_KEY`) are set out-of-band.

Non-secret config (models, URLs, guardrail numbers) lives in `wrangler.jsonc`
`vars` and mirrors `backend/.env.example` / `render.yaml`.

> Requires a **Workers Paid** plan for production traffic; the free plan works for
> testing. Live-scrape and cart endpoints call the same external Railway services
> as the Python backend.
