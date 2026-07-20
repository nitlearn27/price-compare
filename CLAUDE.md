# Price Compare — CLAUDE.md

Grocery price-comparison chat app. The user chats about a product; a server-side agent
searches the Salesforce catalog (the user's own Amazon/Flipkart purchase history), falls
back to live store scrapers when the catalog is thin, and the UI renders a comparison
table plus cart/checkout and "next purchase" recommendations.

## Core flow

```
User → Chat UI → /api/agent/chat → LangGraph StateGraph (agent ⇄ tools → validate → finalize)
        LLM node: DeepSeek (OpenRouter fallback), raw httpx — same for every node
        tools: search_products → AggregatorAgent (hub-spoke):
                 1. Salesforce catalog (fast, has purchase history)
                 2. live Flipkart/Amazon scrapers — only for sources the
                    catalog didn't cover (covers_source is a PREFIX match:
                    "Amazon" covers "Amazon Now" / "Amazon Fresh")
               get_purchase_history · add_to_cart · checkout · refresh_products
→ reply + results + cart[] + checkout + pending_live (phase-2 live via /api/products/live)
```

The agent orchestration lives in `app/services/agent_graph.py` (the `StateGraph`) and
`app/services/agent.py` (`ShoppingAgent` — seeds state, maps to `AgentResponse`, owns the
LLM/tool/dispatch code the nodes reuse). Messages stay as OpenAI-format dicts (no LangChain
message objects) so the raw-httpx `_call_llm` and the respx-at-HTTP test seams are unchanged.
With a `thread_id` the checkpointer persists conversation + cart across turns; a streaming
variant `/api/agent/chat/stream` (SSE) surfaces status/results/reply as the graph runs.

## Stack & layout

- **Backend** `backend/` — FastAPI (Python 3.11), httpx, pydantic v2. No Salesforce SDK — raw REST.
  Reference implementation + local dev; **not deployed** (Cloudflare Worker is the deploy target).
  - `app/routers/` agent, identify, products, recommendations, cart, orders (all under `/api`)
  - `app/agents/` aggregator (hub) + salesforce/flipkart/amazon spokes
  - `app/services/` agent (ShoppingAgent + tools), agent_graph (LangGraph StateGraph),
    salesforce, product_search, cart, recommendations, refresh, otp, gemini
  - LangGraph (`langgraph` + `langchain-core`) drives the agent loop; no full `langchain`
    meta-package (keeps the install light)
  - `app/core/config.py` (pydantic-settings, env-driven) · `logging.py` (secret redaction)
- **Frontend** `frontend/` — React 18 + Vite + TS + Tailwind (no typography plugin), pnpm.
  - `src/components/` chat/, results/, cart/, recommendations/, refresh/, header/
  - `src/hooks/` useChat, useProductSearch, useCart (context), useRecommendations, useRefresh
  - `src/lib/` api.ts, types.ts, strings.ts, source-theme.ts
- **Cloudflare Worker** `worker/` — the **deployed TypeScript** backend (Hono +
  `@langchain/langgraph`) that mirrors `backend/` with the same `/api/*` contract and serves the
  SPA as static assets. Live at `https://price-compare.nit4infy1.workers.dev`. See its own
  section below + `worker/README.md`.

## API contract (FE ↔ BE)

- `POST /api/agent/chat` `{messages, thread_id?}` → `{reply, results, cart, checkout, pending_live, thread_id}`
  — main chat path. If `pending_live` is set, FE calls `POST /api/products/live` and appends rows.
  With `thread_id` the server persists history + cart (client sends only the newest turn);
  without it, stateless (client owns full history) — backward compatible.
- `POST /api/agent/chat/stream` — same input; streams SSE events `status` / `results` /
  `pending_live` / `reply` / `done` / `error` (`done` carries the full `AgentResponse`). FE
  (`useChat`) prefers this; falls back to `/api/agent/chat` only if the stream never starts.
- `POST /api/products/live` `ProductQuery` → `{results}` — phase-2 slow live rows.
- `POST /api/cart/checkout` `{products:[{name,source}]}` → `{submitted, detail}`.
- `POST /api/recommendations/next-purchase`, `/api/identify` (photo), `/api/products/refresh`, `/api/otp`.
- All searching goes through the agent — there are no direct catalog/store search endpoints.

## Backend rules that must not regress

- **Salesforce**: object is `Grocery_Product__c`. OAuth client-credentials; token cached,
  refreshed ~5 min early, 401 → re-auth once and retry, guarded by an `asyncio.Lock`.
  Field lookups are case-insensitive (`Title__c` vs `title__c`).
- **SOQL**: `escape_soql` order is mandatory: `\` first, then `'`, `%`, `_`. Tokenize query,
  drop stopwords, cap 5 tokens; AND-of-tokens first, OR fallback only on zero AND results.
  Never concatenate unescaped user input.
- **Ranking** (`product_search.rank_and_group`): score by `number_of_times_purchased` desc,
  tiebreak `rank__c` asc; top 3 per source, no padding. Discount computed if null.
- **Relevance** (`product_search`: `query_tokens`/`relevance_of_title`/`min_relevance`/
  `filter_relevant`): a row's relevance = # query tokens (substring) in its title. `min_relevance`
  rule — if ANY row is a full-token match, require a full match (drops brand-only/type-only
  partials like "Nandini Curd" for "nandini butter"); else keep ≥1 token; else keep all. Applied
  in `rank_and_group` (catalog) AND `rank_by_value` (live spokes — previously unfiltered). This is
  deterministic/instant; the `validate` graph node adds a semantic LLM pass on top.
- **Buy suggestion tiers**: 0/null→`new`; ≥3→`frequent`; ≥1 & ≥7 days (or unknown date)→`restock`;
  ≥1 & <7 days→`recent`. Pure function of `(times, last_ordered_date, today)`.
- **Agent graph** (`services/agent_graph.py`): `agent ⇄ tools → validate → finalize` `StateGraph`.
  Nodes are closures over `ShoppingAgent` (reuse `_call_llm`, `_dispatch`, live `_settings`). Guardrails
  are edges/node logic, behavior-identical to the old loop: `agent_max_steps` (route to
  `finalize`), `agent_token_budget` (same edge), `agent_max_tool_calls_per_step` (index cap in
  `tools`), `MAX_IDENTICAL_CALLS=2` repeat guard (`call_counts` channel), forced tools-off
  `finalize`. Termination = "no `tool_calls`" (not `finish_reason`). The `validate` node runs a
  semantic relevance pass over search results (one LLM call, gated to ≥2 results, `agent_validate_relevance`,
  fail-open) and emits a refined `results` event after `tools`' fast one — see the relevance
  filtering rule below. When it drops rows it also APPENDS a `system` "relevance note" (append-only
  `messages`, so it steers rather than rewrites the tool output) so the reply the `agent`/`finalize`
  node composes lists only the validated products — keeping the prose table in sync with the grid.
  `messages` + `cart` PERSIST
  across turns; `results`/`total_tokens`/`step`/`call_counts`/`last_query` are per-run and reset each turn
  (that's why `results`/`total_tokens` are plain overwrite channels, not reducers — a reducer
  can't be reset from the input). The `checkout` money-gate stays: unconfirmed → no submit.
- **Checkpointer** (`agent_checkpointer`, default `memory`): thread-scoped state via
  `MemorySaver`. **Caveat:** MemorySaver is per-process and lost on restart/redeploy
  (and never evicts), so cross-turn memory is best-effort; durable state
  needs an external DB (`langgraph-checkpoint-postgres`). `none` disables persistence. Tests
  keep `ShoppingAgent.run`/`_dispatch` seams + respx-at-HTTP mocking — do NOT route LLM calls
  through an SDK (breaks the `respx.post(DEEPSEEK_URL)` stubs).
- **Aggregator coverage**: a live spoke is skipped when catalog sources *start with* its
  `covers_source` (case-insensitive). Spokes run in parallel under `aggregator_spoke_timeout`
  (90s — live scrapes take 30–60s); a spoke failure/timeout becomes a status, never an exception.
- **Cart checkout** (`services/cart.py`): items split by source; each item is also cross-resolved
  to the *other* store (DeepSeek extracts core keyword → match against Salesforce purchase
  history). Upstream cart APIs are async: 202 = queued (wording must say "shortly"),
  409 = busy → retry 3× then accept. One store failing must NOT sink the other —
  partial success returns 200 with a "Couldn't submit to X" note; only all-fail raises (→502).
- **Env names** (see `.env.example` / `worker/wrangler.jsonc`): `FLIPKART_ADD_CART_URL`,
  `AMAZON_ADD_CART_URL`, `SEARCH_PRODUCT_{FLIPKART,AMAZON}_URL`, `REFRESH_{AMAZON,FLIPKART}_URL`,
  `RECOMMENDATION_API_URL`, `OTP_API_URL`, `SF_*`, `DEEPSEEK_API_KEY` (primary),
  `OPENROUTER_API_KEY` (fallback), `GEMINI_API_KEY` (photo identify).
- Never log secrets/tokens (`_RedactingFilter` is defense-in-depth, not permission).

## Cloudflare Workers backend (`worker/`)

A full TypeScript port of `backend/` on Cloudflare Workers (Hono + `@langchain/langgraph`).
Workers can't run the Python app (V8 isolates — no `uvicorn` / native `pydantic-core` / `orjson` /
langgraph wheels), so this is a reimplementation with **behavioral parity**, same `/api/*` contract.
Serves the Vite build as static assets (`run_worker_first: ["/api/*"]`, SPA fallback). Bundles to
~490 KiB gzip. Live: `https://price-compare.nit4infy1.workers.dev`.

- **Parity is the rule:** any `backend/` behavior change (ranking, buy tiers, aggregator coverage,
  guardrails, cart 202/409) MUST be mirrored in `worker/src/` — the two backends must not drift.
  Layout mirrors Python: `lib/` (config, salesforce, product_search, live_search, cart, otp,
  refresh, recommendations, gemini, cart_analysis), `agents/` (aggregator + spokes), `agent/`
  (llm, tools, graph + `ShoppingAgent`), `routers/`. Wire types are snake_case (identical JSON).
- **Graph:** `@langchain/langgraph` `StateGraph` (agent ⇄ tools → validate → finalize), same
  guardrails + relevance `validate` node as the Python graph. Messages are plain OpenAI dicts (no
  LangChain message objects).
- **State:** no in-process checkpointer (isolates are ephemeral). With a KV binding (`AGENT_STATE`)
  + a `thread_id`, `ShoppingAgent` persists `{messages, cart}` to KV (TTL 1 day); without KV it runs
  stateless. `AGENT_CHECKPOINTER` = `kv` | `none`. KV is currently NOT bound in prod (stateless).
- **Config/secrets:** non-secret vars live in `wrangler.jsonc` (committed). Six **encrypted secrets**
  set via `wrangler secret put`, never committed: `SF_TOKEN_URL` (carries the org My Domain —
  treated as a secret), `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `DEEPSEEK_API_KEY`,
  `OPENROUTER_API_KEY`, `GEMINI_API_KEY`. `worker/.dev.vars` (git-ignored) holds them for local dev.
- **Deploy** — secrets are encrypted at rest and persist across deploys (`wrangler deploy` never
  clears them): `(cd ../frontend && pnpm build)` → `./scripts/put-secrets.sh` (only when a value
  changes) → `wrangler deploy`. Full guide in `worker/README.md`.

## Frontend rules that must not regress

- Desktop: two panes (chat ~38% / results ~62%). Mobile: Chat/Results tabs — **never
  auto-switch tabs on search**; the reply renders a markdown table in-chat (`remark-gfm`
  + `.chat-md` styles in `index.css`) and a mobile-only "View full comparison (N)" chip
  switches tabs on tap.
- Results pane states: idle ("Ready when you are", before first search — `hasSearched` prop),
  loading shimmer, error, empty ("No products found"), grouped table (desktop) / cards (mobile).
- All user-facing strings in `lib/strings.ts`; per-source accents/labels in `lib/source-theme.ts`
  (new source = one `THEMES` entry, default gray).
- Cart is a React context (`CartProvider` in `main.tsx`); checkout clears cart on success,
  drawer auto-closes after 2.5s.

## Testing & quality gate

- Backend: `cd backend && .venv/bin/python -m pytest -q` — 149 tests, all external HTTP
  (Salesforce, DeepSeek, scrapers) mocked via respx/monkeypatch. **Never call real LLM or
  scraper endpoints from tests.** `ruff check .` must be clean (line length 100). The agent
  graph is tested at the `ShoppingAgent.run`/`run_stream`/`_dispatch` level in `test_agent.py`
  (respx scripts the provider URLs; `stub_aggregator` fakes the catalog) — including cross-turn
  cart persistence and the SSE event sequence.
- Frontend: `pnpm vitest run` (138 tests) · `pnpm typecheck` · `pnpm lint` (max-warnings 0).
- Worker (`worker/`): `pnpm typecheck` · `pnpm test` (vitest — the LangGraph loop, guardrails, and
  SSE stream are covered with a mocked `fetch`; no keys or servers needed). Same "never hit real
  LLM/scrapers in tests" rule. `wrangler deploy --dry-run` validates the bundle.
- E2E: `pnpm exec playwright test` — needs both dev servers running.
- Manual testing: recommendations are fast/safe; live scrape endpoints
  (`/api/products/live`, `/refresh`) take 30–60s+ — avoid unless asked.
  Cart checkout POSTs to real Railway services (adds to real store carts).

## Local dev

```bash
# Python backend (reference implementation)
cd backend && .venv/bin/uvicorn app.main:app --reload    # :8000
cd frontend && pnpm dev                                  # :5173, proxies /api → :8000

# OR Cloudflare Worker (TS target) — serves API + built SPA on one origin
cd frontend && pnpm build                                # build the SPA (static assets)
cd worker && pnpm dev                                    # :8787 (needs worker/.dev.vars)
```

## Coding standards

- Type everything (no `any`, no untyped Python signatures). Small modules; components <~150 lines.
- Explicit error handling with context; don't swallow. Comments only where the *why* is non-obvious.
- Config only via env vars — never hard-code secrets or URLs in code.
