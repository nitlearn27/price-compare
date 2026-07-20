# Price Compare

AI-powered shopping assistant that compares product prices across Indian e-commerce stores (Amazon, Flipkart, Croma, Reliance Digital). Users describe what they're looking for in chat — the assistant calls a tool, queries Salesforce, and renders the top 3 matches per store as a side-by-side comparison table with product thumbnails and a polished Apple-style dark UI.

> **Repo:** https://github.com/nitesh22778844/price-compare

---

## Table of contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Salesforce `Product__c` schema](#salesforce-product__c-schema)
- [Setup](#setup)
- [Starting & stopping the app](#starting--stopping-the-app)
- [Usage](#usage)
- [How it works](#how-it-works)
- [UI / design](#ui--design)
- [API reference](#api-reference)
- [Testing](#testing)
- [Configuration reference](#configuration-reference)
- [Security notes](#security-notes)
- [Further reading](#further-reading)

---

## Architecture

```
User → React chat UI ──► /api/agent/chat[/stream] ──► LangGraph StateGraph (agent ⇄ tools → finalize)
                              LLM: DeepSeek (OpenRouter fallback), OpenAI-style tool calling
                              tools: search_products ─► AggregatorAgent (hub-spoke):
                                        1. Salesforce catalog (fast, has purchase history)
                                        2. live Flipkart/Amazon scrapers (only for
                                           sources the catalog didn't cover)
                                     get_purchase_history · add_to_cart · checkout · refresh_products
        ◄── reply + comparison table + cart + pending_live (phase-2 rows via /api/products/live)
```

| Layer       | Stack                                                           |
| ----------- | --------------------------------------------------------------- |
| Frontend    | React 18, Vite, TypeScript, Tailwind CSS, lucide-react          |
| Backend (prod) | Cloudflare Worker — Hono + `@langchain/langgraph` (TypeScript), serves the SPA |
| Backend (reference) | FastAPI (Python 3.11+), httpx (async), Pydantic v2, LangGraph |
| LLM         | DeepSeek (primary) with OpenRouter fallback — tool calling      |
| Data store  | Salesforce `Grocery_Product__c` custom object via REST API      |
| Tests       | pytest + respx (BE), Vitest + RTL (FE + worker), Playwright (E2E) |

---

## Repository layout

```
price-compare/
├── CLAUDE.md             # Detailed spec / source of truth for AI agents
├── README.md             # This file
├── .env.example          # All env vars documented
├── frontend/             # Vite + React app
│   ├── src/
│   │   ├── components/           # chat/, results/, cart/, recommendations/, refresh/
│   │   ├── hooks/                # useChat, useProductSearch, useCart, useRecommendations
│   │   ├── lib/                  # api, types, source-theme, strings
│   │   ├── pages/App.tsx
│   │   └── styles/index.css      # dark aurora background, glass utilities
│   └── tests/                    # Vitest unit + Playwright e2e
├── worker/               # Cloudflare Worker (TypeScript) — the DEPLOYED backend
│   ├── src/
│   │   ├── agent/        # llm, tools, LangGraph StateGraph + ShoppingAgent
│   │   ├── agents/       # aggregator (hub) + salesforce/flipkart/amazon spokes
│   │   ├── lib/          # config, salesforce, product_search, cart, otp, refresh, …
│   │   ├── routers/      # agent, identify, products, cart, orders, recommendations
│   │   └── models/       # schemas.ts (wire types, snake_case)
│   └── wrangler.jsonc    # non-secret config; secrets via `wrangler secret put`
└── backend/              # FastAPI app (reference implementation / local dev)
    ├── app/
    │   ├── main.py
    │   ├── routers/      # agent.py, identify.py, products.py, cart.py, orders.py, …
    │   ├── services/     # agent.py, agent_graph.py, salesforce.py, product_search.py, …
    │   ├── models/       # schemas.py
    │   └── core/         # config.py, logging.py
    └── tests/            # pytest + fixtures/salesforce/*.json
```

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (`pnpm` recommended — `npm i -g pnpm`)
- A **Salesforce org** (Developer Edition is fine) with:
  - A `Product__c` custom object populated with product rows (fields below).
  - A **Connected App** with **"Enable Client Credentials Flow"** turned on, and a "Run As" user assigned. Capture the consumer key + secret.
- An **OpenRouter API key** (https://openrouter.ai).

---

## Salesforce `Product__c` schema

Fields the backend reads:

| API name             | Type             | Used as                                  |
| -------------------- | ---------------- | ---------------------------------------- |
| `Id`                 | (system)         | listing id                               |
| `Name`               | Auto Number      | title fallback                           |
| `title__c`           | Text(255), External ID | display title + match target       |
| `source__c`          | Text(100)        | grouping key — e.g. `Amazon`, `Flipkart` |
| `current_price__c`   | Number(16, 2)    | price                                    |
| `original_price__c`  | Number(16, 2)    | MRP / strike-through                     |
| `discount__c`        | Percent(18, 0)   | discount pill (computed if null)         |
| `rating__c`          | Text(100)        | star rating                              |
| `review_count__c`    | Number(18, 0)    | reviews                                  |
| `rank__c`            | Number(18, 0)    | vendor rank                              |
| `product_url__c`     | URL(255)         | "View" link                              |
| `image_url__c`       | URL(255)         | product thumbnail in the comparison table |

Other org fields (`brand__c`, `model__c`, `availability__c`, `specifications__c`, `scraped_at__c`) exist but are not consumed by the current UI.

---

## Setup

### 1. Clone

```bash
git clone https://github.com/nitesh22778844/price-compare.git
cd price-compare
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in:
#   SF_TOKEN_URL          # https://<your-domain>.my.salesforce.com/services/oauth2/token
#   SF_CLIENT_ID          # Connected App consumer key
#   SF_CLIENT_SECRET      # Connected App consumer secret
#   OPENROUTER_API_KEY    # from openrouter.ai
```

`.env` is gitignored — never commit secrets.

### 3. Install backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -e ".[dev]"
```

### 4. Install frontend

```bash
cd frontend
pnpm install
```

The Vite dev server proxies `/api/*` to the FastAPI server, so frontend code uses relative URLs.

---

## Starting & stopping the app

The app needs **two processes running side-by-side**: FastAPI (port 8000) and Vite (port 5173). Pick whichever flow fits your shell.

### Option A — two foreground shells (simplest, recommended for dev)

**Shell 1 — backend:**
```bash
cd backend
.venv\Scripts\activate          # Windows  (or: source .venv/bin/activate)
uvicorn app.main:app --reload   # → http://127.0.0.1:8000  (OpenAPI at /docs)
```

**Shell 2 — frontend:**
```bash
cd frontend
pnpm dev                        # → http://localhost:5173
```

Stop either with **Ctrl+C** in its shell.

### Option B — Windows PowerShell, both in background windows

Launch both servers in their own terminal windows with one command:

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\ClaudeWork\price-compare\backend'; python -m uvicorn app.main:app --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\ClaudeWork\price-compare\frontend'; pnpm dev"
```

**Stop both** by killing whatever is bound to ports 8000 and 5173:

```powershell
Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

**Restart** = stop (above) + start (above), in that order.

### Option C — macOS / Linux, both in background

```bash
(cd backend && source .venv/bin/activate && uvicorn app.main:app --reload) &
(cd frontend && pnpm dev) &
```

**Stop both:**
```bash
lsof -ti:8000,5173 | xargs kill -9 2>/dev/null
```

### Verify it's running

- Backend health: open http://127.0.0.1:8000/docs (Swagger UI).
- Frontend: open http://localhost:5173.
- If the chat sends but the table never updates, check the backend shell — token/auth errors and Salesforce 4xx/5xx surface there.

---

## Usage

1. Open http://localhost:5173.
2. Type something like *"Find me a OnePlus 12"*, *"any pen drive"*, or *"gaming laptop under 80000"* — or click an example prompt.
3. The assistant interprets the request, queries Salesforce, and the right-hand pane renders results grouped by store with the top 3 per source — including product thumbnails, prices, ratings, and a "View" link out to the listing.

---

## How it works

### The agent loop

`POST /api/agent/chat` (or the SSE variant `/api/agent/chat/stream`) runs a LangGraph
`StateGraph` server-side: the model observes real tool results, reasons, and acts again
until it has a final answer. Tools: `search_products` (hub-spoke aggregator),
`get_purchase_history`, `add_to_cart`, `checkout` (gated on explicit user confirmation),
and `refresh_products`. Guardrails cap steps, tokens, tool calls per step, and identical
repeat calls. With a `thread_id`, conversation + cart persist across turns server-side.

### Salesforce lookup (inside `search_products`)

1. **Tokenize** the query, drop stopwords (`a`, `the`, `price`, `best`, etc.), cap at 5 tokens.
2. **AND-of-tokens** SOQL: `title__c LIKE '%t1%' AND title__c LIKE '%t2%' ...`. Properly escaped (`\`, `'`, `%`, `_`).
3. **OR-of-tokens fallback** if the AND query returned zero records — surfaces partial matches.
4. Cap at `LIMIT 200`.

Auth uses **OAuth 2.0 Client Credentials Flow**. The token is cached in memory and refreshed ~5 min before expiry. On a 401 from a data call, the backend invalidates the token, re-auths once, and retries.

Live Flipkart/Amazon spokes run only for sources the catalog didn't cover (prefix
match — "Amazon" covers "Amazon Now"/"Amazon Fresh"); their slow rows arrive as a
phase-2 `POST /api/products/live` fetch that the UI appends to the table.

### Ranking + grouping

Salesforce can't do per-group `LIMIT`, so:

1. Group records by `source__c`.
2. Sort by query relevance (token hits in the title), then times purchased, then vendor rank.
3. Keep top 3 per source. Don't pad — fewer matches → return what's available.
4. Compute `discount__c` from current/original price if it's null, and derive a
   buy suggestion (`new`/`frequent`/`restock`/`recent`) from purchase history.

---

## UI / design

The frontend ships with a polished **dark, Apple-style aesthetic**:

- **Aurora background** — pure black canvas with five overlapping radial gradients in indigo, cyan, magenta, purple, and sky-blue placed at the corners. An SVG fine-grain noise overlay (`mix-blend-mode: overlay`, 5% opacity) adds the film-grain texture you see on Apple's product pages.
- **Frosted glass panels** — header, comparison-pane header, and chat header use `backdrop-filter: blur(20px) saturate(180%)` for the unmistakable Apple navigation feel.
- **Per-source accent colors** — Amazon → orange, Flipkart → blue, Croma → green, Reliance Digital → red. Each row carries a 3px left border in its accent; group headers get a tinted band; the first row of each group gets a *"Top match"* badge. Adding a new store = one entry in `frontend/src/lib/source-theme.ts`.
- **Product thumbnails** — every row shows a 40×40 thumbnail sourced from `image_url__c`. If the URL fails to load (or is null), the row falls back to a tinted placeholder using the store's accent.
- **Refined typography** — Inter with tight letter-spacing (`-0.011em`) and SF Pro-style stylistic alternates (`cv02 cv03 cv04 cv11`).
- **Tactile interactions** — gradient send button with hover-glow + `active:scale-95`, animated typing dots, glow-shadow on the indigo logo, subtle shimmer on table loading skeletons.

---

## API reference

### `POST /api/agent/chat`

Request:
```json
{
  "messages": [
    { "role": "user", "content": "find me a OnePlus 12" }
  ],
  "thread_id": "optional-session-uuid"
}
```

Response:
```json
{
  "reply": "Here are the best OnePlus 12 deals…",
  "results": [
    {
      "id": "a001A00000AbCdEQAV",
      "title": "OnePlus 12 5G 256GB Black",
      "source": "Amazon",
      "origin": "catalog",
      "current_price": 62999,
      "original_price": 69999,
      "discount": 10,
      "rating": "4.5",
      "review_count": 12400,
      "rank": 3,
      "product_url": "https://amazon.in/dp/B0ABCDE",
      "image_url": "https://m.media-amazon.com/images/I/abc.jpg",
      "times_purchased": 2,
      "buy_suggestion": "restock"
    }
  ],
  "cart": [],
  "checkout": null,
  "pending_live": { "query": "OnePlus 12", "sources": ["flipkart"] },
  "thread_id": "optional-session-uuid"
}
```

`results` is grouped by source, top 3 per source. With a `thread_id` the server keeps
conversation + cart across turns (send only the newest message). If `pending_live` is
set, fetch the slow live rows with `POST /api/products/live` and append them.

### `POST /api/agent/chat/stream`

Same request; responds as Server-Sent Events: `status` → `results` → `pending_live` →
`reply` → `done` (the full response above) or `error`. The UI prefers this endpoint and
falls back to `/api/agent/chat` only if the stream never starts.

### Other endpoints

`POST /api/products/live` · `POST /api/cart/checkout` · `POST /api/recommendations/next-purchase` ·
`POST /api/identify` (photo) · `POST /api/products/refresh` · `POST /api/otp`.

---

## Testing

| Suite              | Command                               | Status                       |
| ------------------ | ------------------------------------- | ---------------------------- |
| Backend unit + integration | `cd backend && pytest`        | **149 tests, ~81% coverage**  |
| Frontend unit + component  | `cd frontend && pnpm test`    | **138 tests passed**          |
| Worker unit               | `cd worker && pnpm test`       | vitest, mocked `fetch`        |
| Frontend type check        | `cd frontend && pnpm typecheck` | clean                      |
| Backend lint               | `cd backend && ruff check .`  | clean                        |
| E2E (requires both servers) | `cd frontend && pnpm test:e2e` | Playwright                  |

All external HTTP (Salesforce, DeepSeek/OpenRouter, scrapers) is mocked in unit tests (`respx` / vitest), so no real credentials are needed to run them. Test fixtures for Salesforce responses live in `backend/tests/fixtures/salesforce/`.

---

## Configuration reference

All config via environment variables. See `.env.example` for the canonical list.

| Variable                | Purpose                                              | Default                                                  |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `SF_TOKEN_URL`          | Salesforce OAuth token endpoint (My Domain preferred) | `https://login.salesforce.com/services/oauth2/token`     |
| `SF_CLIENT_ID`          | Connected App consumer key                           | *(required)*                                             |
| `SF_CLIENT_SECRET`      | Connected App consumer secret                        | *(required)*                                             |
| `SF_API_VERSION`        | Salesforce REST API version                          | `60.0`                                                   |
| `SF_QUERY_LIMIT`        | Max records pulled from SOQL before ranking          | `200`                                                    |
| `SF_RESULTS_PER_SOURCE` | Top N per source returned to FE                      | `3`                                                      |
| `DEEPSEEK_API_KEY`      | DeepSeek API key (primary agent LLM)                 | *(required)*                                             |
| `OPENROUTER_API_KEY`    | OpenRouter API key (fallback LLM)                    | *(optional)*                                             |
| `OPENROUTER_MODEL`      | OpenRouter model id                                  | `openai/gpt-oss-120b`                                    |
| `GEMINI_API_KEY`        | Google Gemini key (photo identify)                   | *(optional)*                                             |
| `CORS_ALLOW_ORIGINS`    | Comma-separated origins for CORS                     | `http://localhost:5173`                                  |
| `LOG_LEVEL`             | Python log level                                     | `INFO`                                                   |
| `RECOMMENDATION_API_URL`| "Next purchase" recommendation engine endpoint       | `https://insight-generation-production.up.railway.app/api/insights/next-purchase` |

---

## Cart Checkout & Recommendations

### 1. Split Cart Checkout Routing
When checking out, products are routed to their respective vendor APIs (`FLIPKART_ADD_CART_URL` and `AMAZON_ADD_CART_URL`) concurrently.
- **Cross-Vendor Matching**: When an item with a selected vendor (e.g., Amazon) is submitted, the system ALSO extracts the core keyword (e.g. `"brinjal"`) using DeepSeek, queries your Salesforce history for the best matching Flipkart product title, and dispatches it to Flipkart. This ensures matching items are added to both carts automatically.

### 2. Next Purchase Recommendations
- Prompts the user with recommended items to buy based on previous purchase frequency and recency.
- Recommendation items are enriched with high-quality product images by querying `image_url__c` from Salesforce.
- Ratings returned in JSON format from the Amazon search microservice are automatically parsed and normalized for display.

---

## Deployment (Cloudflare Workers)

The app deploys as a single Cloudflare Worker (`worker/`) that serves both the `/api/*`
backend and the built SPA as static assets:

```bash
cd frontend && pnpm build          # build the SPA
cd ../worker
./scripts/put-secrets.sh           # once, or when a secret value changes
pnpm exec wrangler deploy          # → https://price-compare.<account>.workers.dev
```

Non-secret config lives in `worker/wrangler.jsonc`; the six secrets (`SF_TOKEN_URL`,
`SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`GEMINI_API_KEY`) are encrypted Wrangler secrets and persist across deploys.
See `worker/README.md` for the full guide.

---

## Security notes

- Secrets live only in `.env` (gitignored) or your secrets manager. `.env.example` is committed but contains no real values.
- A `_RedactingFilter` in `backend/app/core/logging.py` scrubs `SF_CLIENT_SECRET` and `OPENROUTER_API_KEY` from any log line that contains them — defense-in-depth on top of "don't log secrets in the first place."
- Authorization headers and access tokens are never logged.
- All SOQL is built with proper escaping (`\`, `'`, `%`, `_`) to prevent SOQL injection.
- Product images load from `image_url__c` URLs returned by Salesforce — point this field at trusted CDNs only, since the URLs render as `<img src>` in the user's browser.
- In production, prefer a My Domain URL (`https://<your-domain>.my.salesforce.com/...`) over `login.salesforce.com`.

---

## Further reading

- `CLAUDE.md` — detailed spec, including ranking algorithm, tool schema, system prompt strategy, build order. Useful when extending the app or onboarding an AI agent.
- `backend/app/services/salesforce.py` — auth flow, escaping, AND→OR fallback.
- `backend/app/services/product_search.py` — ranking + grouping logic.
- `frontend/src/lib/source-theme.ts` — per-source visual identity.
- `frontend/src/styles/index.css` — aurora background, noise overlay, glass utilities.
