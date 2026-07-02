# Price Compare — CLAUDE.md

Grocery price-comparison chat app. The user chats about a product; a server-side agent
searches the Salesforce catalog (the user's own Amazon/Flipkart purchase history), falls
back to live store scrapers when the catalog is thin, and the UI renders a comparison
table plus cart/checkout and "next purchase" recommendations.

## Core flow

```
User → Chat UI → /api/agent/chat → DeepSeek agent loop (OpenRouter fallback)
        tools: search_products → AggregatorAgent (hub-spoke):
                 1. Salesforce catalog (fast, has purchase history)
                 2. live Flipkart/Amazon scrapers — only for sources the
                    catalog didn't cover (covers_source is a PREFIX match:
                    "Amazon" covers "Amazon Now" / "Amazon Fresh")
               get_purchase_history · add_to_cart · checkout · refresh_products
→ reply + results + cart[] + pending_live (phase-2 live results fetched via /api/products/live)
```

## Stack & layout

- **Backend** `backend/` — FastAPI (Python 3.11), httpx, pydantic v2. No Salesforce SDK — raw REST.
  - `app/routers/` agent, chat, identify, products, recommendations, cart, orders (all under `/api`)
  - `app/agents/` aggregator (hub) + salesforce/flipkart/amazon spokes
  - `app/services/` agent loop, salesforce, product_search, cart, recommendations, refresh, otp, gemini
  - `app/core/config.py` (pydantic-settings, env-driven) · `logging.py` (secret redaction)
- **Frontend** `frontend/` — React 18 + Vite + TS + Tailwind (no typography plugin), pnpm.
  - `src/components/` chat/, results/, cart/, recommendations/, refresh/, header/
  - `src/hooks/` useChat, useProductSearch, useCart (context), useRecommendations, useRefresh
  - `src/lib/` api.ts, types.ts, strings.ts, source-theme.ts
- Docker: single image — Vite build served by FastAPI `StaticFiles` from `/app/dist`; `render.yaml` is the deploy blueprint.

## API contract (FE ↔ BE)

- `POST /api/agent/chat` `{messages}` → `{reply, results, cart, pending_live}` — main chat path.
  If `pending_live` is set, FE calls `POST /api/products/live` and appends rows.
- `POST /api/products/search` `ProductQuery` → `{results}` — catalog only, grouped, top 3/source.
- `POST /api/cart/checkout` `{products:[{name,source}]}` → `{submitted, detail}`.
- `POST /api/recommendations/next-purchase`, `/api/identify` (photo), `/api/products/refresh`, `/api/otp`.

## Backend rules that must not regress

- **Salesforce**: object is `Grocery_Product__c`. OAuth client-credentials; token cached,
  refreshed ~5 min early, 401 → re-auth once and retry, guarded by an `asyncio.Lock`.
  Field lookups are case-insensitive (`Title__c` vs `title__c`).
- **SOQL**: `escape_soql` order is mandatory: `\` first, then `'`, `%`, `_`. Tokenize query,
  drop stopwords, cap 5 tokens; AND-of-tokens first, OR fallback only on zero AND results.
  Never concatenate unescaped user input.
- **Ranking** (`product_search.rank_and_group`): score by `number_of_times_purchased` desc,
  tiebreak `rank__c` asc; top 3 per source, no padding. Discount computed if null.
- **Buy suggestion tiers**: 0/null→`new`; ≥3→`frequent`; ≥1 & ≥7 days (or unknown date)→`restock`;
  ≥1 & <7 days→`recent`. Pure function of `(times, last_ordered_date, today)`.
- **Aggregator coverage**: a live spoke is skipped when catalog sources *start with* its
  `covers_source` (case-insensitive). Spokes run in parallel under `aggregator_spoke_timeout`
  (90s — live scrapes take 30–60s); a spoke failure/timeout becomes a status, never an exception.
- **Cart checkout** (`services/cart.py`): items split by source; each item is also cross-resolved
  to the *other* store (DeepSeek extracts core keyword → match against Salesforce purchase
  history). Upstream cart APIs are async: 202 = queued (wording must say "shortly"),
  409 = busy → retry 3× then accept. One store failing must NOT sink the other —
  partial success returns 200 with a "Couldn't submit to X" note; only all-fail raises (→502).
- **Env names** (see `.env.example` / `render.yaml`): `FLIPKART_ADD_CART_URL`,
  `AMAZON_ADD_CART_URL`, `SEARCH_PRODUCT_{FLIPKART,AMAZON}_URL`, `REFRESH_{AMAZON,FLIPKART}_URL`,
  `RECOMMENDATION_API_URL`, `OTP_API_URL`, `SF_*`, `DEEPSEEK_API_KEY` (primary),
  `OPENROUTER_API_KEY` (fallback), `GEMINI_API_KEY` (photo identify).
- Never log secrets/tokens (`_RedactingFilter` is defense-in-depth, not permission).

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

- Backend: `cd backend && .venv/bin/python -m pytest -q` — 173 tests, all external HTTP
  (Salesforce, DeepSeek, scrapers) mocked via respx/monkeypatch. **Never call real LLM or
  scraper endpoints from tests.** `ruff check .` must be clean (line length 100).
- Frontend: `pnpm vitest run` (138 tests) · `pnpm typecheck` · `pnpm lint` (max-warnings 0).
- E2E: `pnpm exec playwright test` — needs both dev servers running.
- Manual testing: catalog search + recommendations are fast/safe; live scrape endpoints
  (`/api/products/live`, `/search/flipkart`, `/refresh`) take 30–60s+ — avoid unless asked.
  Cart checkout POSTs to real Railway services (adds to real store carts).

## Local dev

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload    # :8000
cd frontend && pnpm dev                                  # :5173, proxies /api → :8000
```

## Coding standards

- Type everything (no `any`, no untyped Python signatures). Small modules; components <~150 lines.
- Explicit error handling with context; don't swallow. Comments only where the *why* is non-obvious.
- Config only via env vars — never hard-code secrets or URLs in code.
