# Product Comparison Chatbot — CLAUDE.md

> Source of truth for Claude (or any AI coding agent) when building, extending, or debugging this application. Read fully before writing code.

---

## 1. Project Overview

Web app where the user chats with an AI assistant to describe a product (e.g., *"iPhone 15 Pro 256GB"*). The assistant calls a tool, the backend queries the `Product__c` custom object in Salesforce, and the right-hand pane renders the top 3 matches per source as a comparison table.

**Core flow**

```
User → Chat UI → /api/chat → OpenRouter LLM (tool call: search_products)
                          → /api/products/search → Salesforce REST (SOQL on Product__c)
                          → Python ranking + grouping (top 3 per source)
                          → Frontend ComparisonTable
```

---

## 2. Tech Stack (As Built)

| Layer            | Choice                                                | Notes                                          |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------- |
| Frontend         | React 18 + Vite + TypeScript + Tailwind CSS           | Plain Tailwind, no shadcn/ui.                  |
| UI icons         | `lucide-react`                                        | Sparkles, Send, Star, ExternalLink.            |
| State            | React `useState` + custom hooks (`useChat`, `useProductSearch`) | No Redux/Zustand.                    |
| Backend          | FastAPI (Python 3.11+) — async                        | OpenAPI at `/docs`.                            |
| HTTP             | `httpx` async (backend), `fetch` (frontend)           |                                                |
| Salesforce       | Raw `httpx` against the REST API (no SDK)             | OAuth 2.0 Client Credentials, in-memory cache. |
| LLM gateway      | OpenRouter API                                        | Model configurable via `OPENROUTER_MODEL`.     |
| FE testing       | Vitest + React Testing Library; Playwright for E2E    |                                                |
| BE testing       | pytest + pytest-asyncio + respx + pytest-cov          | Salesforce + OpenRouter both mocked.           |
| Linting          | ESLint + tsc (FE); ruff + black (BE)                  |                                                |
| Package mgmt     | pnpm (FE); pip + pyproject (BE)                       |                                                |

---

## 3. Repository Layout

```
price-compare/
├── CLAUDE.md
├── README.md
├── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/        # ChatWindow, MessageBubble, ChatInput
│   │   │   └── results/     # ComparisonTable, SourceBadge, RatingStars
│   │   ├── hooks/           # useChat, useProductSearch
│   │   ├── lib/             # api, types, source-theme, strings
│   │   ├── pages/           # App.tsx
│   │   └── styles/          # index.css (Tailwind + animations)
│   ├── tests/               # vitest unit + Playwright e2e
│   └── package.json
└── backend/
    ├── app/
    │   ├── main.py          # FastAPI factory + CORS + global handler
    │   ├── routers/         # chat.py, products.py
    │   ├── services/        # openrouter.py, salesforce.py, product_search.py
    │   ├── models/          # schemas.py (Pydantic)
    │   └── core/            # config.py, logging.py (with secret redaction)
    ├── tests/               # pytest + fixtures/salesforce/*.json
    └── pyproject.toml
```

---

## 4. Frontend Specification

### 4.1 Layout

Two-pane responsive layout:
- **Left (~38%):** chat panel.
- **Right (~62%):** comparison table that updates with each search.
- Mobile: single column, table renders below the chat.

### 4.2 Chat UI

- User vs assistant messages styled distinctly (rounded bubbles, AI avatar, subtle shadow).
- Animated 3-dot typing indicator while a request is in flight.
- Auto-scroll to latest message; respects user scroll-up to read history (sticky-bottom only when near bottom).
- Markdown rendering for assistant messages via `react-markdown`.
- Multi-line `<textarea>`: Enter to send, Shift+Enter for newline; auto-grows up to 120px.
- Input + send button disabled while a request is in flight.
- Empty state shows 3 example prompts (`STRINGS.chatExamplePrompts`) — clicking sends immediately.
- Chat history is in-memory React state only (no `localStorage`).

### 4.3 Comparison Table

- Rows are **grouped by source** with a section header (`{Source} — N results`).
- Each row carries a **left border in the source's accent color** + a colored chip in the *Store* column.
- Top row of each group gets a **"Top match"** badge.
- Sticky table header. Numeric columns right-aligned. INR currency formatting.
- Discount rendered as a green pill; rating rendered as filled stars + numeric value (`RatingStars`).
- Loading: 5 shimmer rows. Empty: friendly message. Error: red headline + detail.

**Per-source theme** lives in `frontend/src/lib/source-theme.ts`:

| Source           | Accent    | Chip label |
| ---------------- | --------- | ---------- |
| Amazon           | `#FF9900` | Amazon     |
| Flipkart         | `#2874F0` | Flipkart   |
| Croma            | `#27C14D` | Croma      |
| Reliance Digital | `#C8102E` | RD         |
| (default)        | `#6B7280` | source name |

Adding a new source = one entry in `THEMES`.

**Columns** (in render order):

| Column   | Backend field    | Notes                                       |
| -------- | ---------------- | ------------------------------------------- |
| Product  | `title`          | Truncated to 2 lines; `title=` tooltip.     |
| Store    | `source`         | Colored chip via `SourceBadge`.             |
| Price    | `current_price`  | INR formatted, no fraction.                 |
| MRP      | `original_price` | Strike-through if higher than current.      |
| Discount | `discount`       | Green pill `-NN%` if > 0; computed if null. |
| Rating   | `rating`         | Stars (lucide `Star`) + numeric value.      |
| Reviews  | `review_count`   | Compact: `1.2k`, `1.5L`.                    |
| Rank     | `rank`           | `#N` or `—`.                                |
| (link)   | `product_url`    | "View" → opens in new tab.                  |

### 4.4 Frontend ↔ Backend Contract

**`POST /api/chat`**
- Request: `{ messages: ChatMessage[] }` — full conversation history every call (LLM is stateless server-side).
- Response: `{ reply: string, product_query: ProductQuery | null }`
- If `product_query` is non-null, the frontend immediately calls `/api/products/search` with it.

**`POST /api/products/search`**
- Request: `ProductQuery` (see §5.6).
- Response: `{ results: ProductListing[] }` — already grouped (sorted source-by-source) and capped at 3 per source.

---

## 5. Backend Specification

### 5.1 Responsibilities

1. Accept chat messages from the frontend.
2. Forward full conversation history to the configured OpenRouter model with a `search_products` function tool.
3. When the model emits a `ProductQuery`, query Salesforce's `Product__c` object via SOQL `LIKE`.
4. Rank by `title__c` match quality, group by `source__c`, return top 3 per source.
5. Normalize Salesforce records into `ProductListing`.

### 5.2 OpenRouter Integration (`app/services/openrouter.py`)

- Endpoint: `https://openrouter.ai/api/v1/chat/completions`.
- Auth: `Authorization: Bearer ${OPENROUTER_API_KEY}`.
- Model: `OPENROUTER_MODEL` (default `openai/gpt-oss-120b`).
- Forwards full conversation each call (LLM has no memory).
- Uses **function/tool calling** — the model returns a structured `search_products` call, never free-form parsing.
- Sets `HTTP-Referer` and `X-Title` headers (OpenRouter ranking).

**System prompt strategy:**
- Instruct the model to call `search_products` for any product mention, even vague ("any pen drive", "a gaming laptop").
- Strip filler words from the `query` argument before passing.
- Only reply conversationally for clear non-product turns (greetings, thanks).
- Never invent prices, ratings, or availability.

**Tool schema:** `query` (required), plus optional `category`, `min_price`, `max_price`, `brand`, `sources`.

### 5.3 Salesforce Integration (`app/services/salesforce.py`)

#### 5.3.1 Authentication — OAuth 2.0 Client Credentials Flow

Server-to-server, no interactive login.

Salesforce setup required:
- **Connected App** with **"Enable Client Credentials Flow"**.
- OAuth scope: `api`.
- A **"Run As" user** assigned (integration identity).
- Consumer Key + Consumer Secret captured securely.

Backend flow:
1. POST to `SF_TOKEN_URL` with form body `grant_type=client_credentials`, `client_id`, `client_secret`.
2. Response yields `access_token` + `instance_url`. Cached in memory; refreshed ~5 min before expiry.
3. All data calls go to `<instance_url>/services/data/v{SF_API_VERSION}/query?q=<SOQL>` with `Bearer <access_token>`.
4. On 401 → invalidate cache, re-auth once, retry the call. If it 401s again, surface the error.
5. Cache and access shielded by an `asyncio.Lock` to prevent token-fetch storms.

**Security:**
- `SF_CLIENT_SECRET` only in env vars / secrets manager.
- A `_RedactingFilter` in `app/core/logging.py` scrubs `SF_CLIENT_SECRET` and `OPENROUTER_API_KEY` from any log message that contains them.
- Authorization headers and tokens are never logged.

#### 5.3.2 Querying `Product__c`

**Strategy:** SOQL `LIKE`, parameterized via SF's request body — never concatenate user input directly. We pull up to 200 records and rank in Python.

**Tokenization:**
- Split user query on whitespace.
- Drop stopwords (`_STOPWORDS` in `salesforce.py`: filler verbs, articles, "price", "best", etc.).
- Cap at 5 tokens to keep SOQL length sane.
- If everything was filtered out, fall back to the raw query as a single substring.

**`escape_soql`** order (mandatory): `\` first, then `'`, `%`, `_`. Empty/whitespace-only input is rejected with `ValueError` before the SF call.

**SOQL template** (built by `_build_soql`):
```sql
SELECT Id, Name, title__c, source__c, current_price__c, original_price__c,
       discount__c, rating__c, review_count__c, rank__c, product_url__c,
       image_url__c, last_ordered_date__c, number_of_times_purchased__c
FROM Grocery_Product__c
WHERE <where_clause> AND source__c != null AND source__c != ''
ORDER BY source__c ASC, rating__c DESC NULLS LAST,
         review_count__c DESC NULLS LAST
LIMIT <SF_QUERY_LIMIT>
```

**Two-stage matching strategy:**
1. **AND-of-tokens** (primary): `title__c LIKE '%t1%' AND title__c LIKE '%t2%' AND ...` — each escaped token must appear.
2. **OR-of-tokens** (fallback): triggered only when the AND query returns zero records *and* there are >1 tokens. Surfaces partial matches.

#### 5.3.3 Ranking + grouping (`app/services/product_search.py`)

`rank_and_group(records, query, per_source=3)` (the `query` argument is retained for API symmetry but no longer affects ordering):

1. Group raw records by `source__c`.
2. Score each record (`_score`) by `(number_of_times_purchased__c desc, rank__c asc)`:
   - **Primary:** times purchased — records you've bought most often win (null/0 all tie at 0).
   - **Tie-break:** `rank__c` ascending — lower vendor rank (#1) beats higher (#7). Records with no `rank__c` sort last among ties.
3. Within each source, sort by score desc and keep top `per_source`. The first item per source group is rendered as **"Top match"** in the UI.
4. Normalize each kept record (`_normalize`) into `ProductListing`. If `discount__c` is null but both prices are present and positive, compute it as `round((1 - current/original) * 100)`. Compute `buy_suggestion` + `suggestion_reason` from `number_of_times_purchased__c` and `last_ordered_date__c` (see §5.3.4).
5. **Don't pad** — if a source has fewer than `per_source` matches, return what's available.

#### 5.3.4 Buy suggestion (`_derive_suggestion`)

A tiered hint shown in the "Buy?" column. Pure function of `(times, last_ordered_date, today)` so it's trivially testable with a pinned `today`.

| Condition                                                       | label        |
| --------------------------------------------------------------- | ------------ |
| `times` is null OR `times == 0`                                 | `"new"`      |
| `times >= 3`                                                    | `"frequent"` |
| `times >= 1` AND `last_ordered_date` known AND days ≥ 7         | `"restock"`  |
| `times >= 1` AND `last_ordered_date` known AND days < 7         | `"recent"`   |
| `times >= 1` AND `last_ordered_date` null                       | `"restock"`  |

`suggestion_reason` is a human-readable tooltip (e.g. *"Bought 2x, last 12 days ago"*). The 7-day threshold and frequency cutoff live as `_RESTOCK_THRESHOLD_DAYS` / `_FREQUENT_THRESHOLD` constants in `product_search.py`.

`_ci_get` does case-insensitive field lookup so we tolerate either `Title__c` or `title__c` casing from Salesforce.

### 5.4 `Product__c` Schema (Salesforce org)

Fields the backend reads (case-insensitive):

| API name             | Type             | Used as           |
| -------------------- | ---------------- | ----------------- |
| `Id`                 | (system)         | listing id        |
| `Name`               | Auto Number      | title fallback    |
| `title__c`           | Text(255), External ID | display title + match target |
| `source__c`          | Text(100)        | grouping key      |
| `current_price__c`   | Number(16, 2)    | price             |
| `original_price__c`  | Number(16, 2)    | MRP / strike-through |
| `discount__c`        | Percent(18, 0)   | discount pill (computed if null) |
| `rating__c`          | Text(100)        | star rating       |
| `review_count__c`    | Number(18, 0)    | reviews           |
| `rank__c`            | Number(18, 0)    | vendor rank       |
| `product_url__c`     | URL(255)         | "View" link       |

Other org fields (`brand__c`, `model__c`, `image_url__c`, `availability__c`, `specifications__c`, `scraped_at__c`) exist but are **not** consumed by the current UI.

### 5.5 Configuration

All config via env vars. Documented in `.env.example`:

```
# Salesforce (OAuth 2.0 Client Credentials Flow)
SF_TOKEN_URL=https://login.salesforce.com/services/oauth2/token   # or My Domain
SF_CLIENT_ID=                       # Connected App consumer key
SF_CLIENT_SECRET=                   # Connected App consumer secret — keep secret
SF_API_ENDPOINT=https://<your-domain>.my.salesforce.com/services/data/v60.0/sobjects/Product__c/
SF_API_VERSION=60.0
SF_QUERY_LIMIT=200                  # SOQL cap
SF_RESULTS_PER_SOURCE=3             # top N per source returned to FE

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-oss-120b

# App
CORS_ALLOW_ORIGINS=http://localhost:5173
LOG_LEVEL=INFO
```

`SF_API_ENDPOINT` is documentation-only (the code derives the actual API URL from `SF_TOKEN_URL` → `instance_url` returned by auth). Never hard-code secrets. Never log the access token, client secret, or full Authorization header.

### 5.6 Schemas (`app/models/schemas.py`)

```python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

class ProductQuery(BaseModel):
    query: str = Field(..., min_length=1)
    category: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    brand: str | None = None
    sources: list[str] | None = None

class ProductListing(BaseModel):
    id: str
    title: str
    source: str
    current_price: float | None = None
    original_price: float | None = None
    discount: int | None = None
    rating: str | None = None
    review_count: int | None = None
    rank: int | None = None
    product_url: str | None = None

class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)

class ChatResponse(BaseModel):
    reply: str
    product_query: ProductQuery | None = None

class ProductSearchResponse(BaseModel):
    results: list[ProductListing]
```

---

## 6. Testing

### 6.1 Backend (`pytest`)

Current state: **54 tests pass, 89% coverage** on `app/`.

- **`test_salesforce.py`** — `escape_soql` parametrized escape order; token request body shape; token cache reuse; expiry-triggered refresh; 401 retry-once; second-401 surfaces; 5xx surfaces; empty query rejected before SF call; client secret never appears in captured logs.
- **`test_product_search.py`** — full-query substring outscores token matches; tiebreak by rating then review count; `_normalize` computes discount when null, keeps explicit discount, omits when prices equal; missing optional fields don't crash; title-fallback to `Name`; per-source cap respected; under-cap groups returned at actual size.
- **`test_openrouter.py`** — system prompt + tool schema present in payload; full conversation history forwarded; tool call parses to `ProductQuery`; plain text reply yields `None` query; 4xx/5xx/timeout all surface.
- **`test_routers.py`** — `/api/chat` and `/api/products/search` happy paths, validation errors, 502 on upstream failure, end-to-end integration with both services mocked.
- **Fixtures**: `tests/fixtures/salesforce/{happy_path,partial_fields,empty_result}.json`.

`tests/conftest.py` autouses an `override_settings` fixture so no real credentials are needed.

### 6.2 Frontend (`vitest`)

Current state: **44 tests pass** across 6 files.

- `ChatInput.test.tsx` — render, disabled state, onChange, Enter submits, Shift+Enter doesn't, empty value rejected.
- `MessageBubble.test.tsx` — user vs assistant rendering, ARIA labels, typing indicator dots.
- `ComparisonTable.test.tsx` — empty/loading/error states; product rendering; group headers; "Top match" only on first row of each group; discount pill; strikethrough MRP; View link target; multi-source grouping.
- `RatingStars.test.tsx` — null → dash; numeric value rendered; 5 stars; non-numeric falls back to text; ARIA label.
- `SourceBadge.test.tsx` + source-theme contract — every supported source resolves to expected accent + label; unknown source gets gray accent + own name.
- `useProductSearch.test.ts` — initial state, loading transition, success, error.

### 6.3 E2E (Playwright, `frontend/tests/e2e/`)

`comparison.spec.ts` — empty state visible, chat input accepts text, example prompt click, app title, comparison panel header on desktop, single-column on mobile. Requires both servers running (`pnpm dev` + `uvicorn`).

### 6.4 Quality gate

App is "ready" when:
- `pytest` passes (target ≥ 85% coverage on services/routers — currently 89%).
- `vitest run` passes.
- `pnpm typecheck` (tsc --noEmit) passes.
- `ruff check .` clean.
- E2E specs pass against locally running stack.
- Manual smoke on a real Salesforce sandbox: chat works, table renders grouped, error states behave, token refresh works after expiry.

---

## 7. Coding Standards

- Type everything. No `any` in TS, no untyped function signatures in Python.
- Small modules, pure functions where reasonable; components < ~150 lines.
- Explicit error handling — never silently swallow; log with context (but never log secrets — `_RedactingFilter` is a defense-in-depth, not a license to log them).
- All user-facing strings live in `frontend/src/lib/strings.ts`.
- Per-source visuals live in `frontend/src/lib/source-theme.ts` — adding a new source is a one-file change.
- Accessibility: semantic HTML, keyboard-navigable chat + table, ARIA labels on icon-only buttons, color contrast verified for source chips against white text.

---

## 8. Local development

```bash
# Backend
cd backend
source .venv/bin/activate   # or source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload                     # http://127.0.0.1:8000

# Frontend (separate shell)
cd frontend
pnpm install
pnpm dev                                          # http://localhost:5173
```

Vite dev server proxies `/api/*` → `http://localhost:8000`, so the frontend code calls relative URLs (`/api/chat`, `/api/products/search`).

---

## 9. Build order (historical, for reference)

1. Schemas in both languages.
2. `services/salesforce.py` — Client Credentials auth + token cache + SOQL helpers, fully mocked tests.
3. `services/product_search.py` — ranking, grouping, top-N-per-source.
4. `services/openrouter.py` — tool calling.
5. Routers `/api/chat`, `/api/products/search`.
6. Chat UI shell with mocked responses.
7. Source theme + `ComparisonTable`.
8. Connect FE to BE; verify the loop end-to-end.
9. Swap mocks for real OpenRouter + Salesforce sandbox; tune system prompt + SOQL.
10. E2E tests + full quality gate.
