# Product Comparison Chatbot — claude.md
>This file is the source of truth for Claude (or any AI coding agent) when building, extending, or debugging this application. Read it fully before writing any code.
---

## 1. Project Overview

A web application where a user chats with an AI assistant to describe a product they're interested in (e.g., "iPhone 15 Pro 256GB"). The assistant interprets the request, queries the `Poduct__c` ustom object in Salesforce, and renders the top matches per source as a comparison table on the right side of the screen.

**Core flow**
`
User → Chat UI → OpenRouter LLM (intent + entity extraction)
     → Backend API → Salesforce REST API (SOSL/SOQL on Product__c)
     → Top 3 matches per source → Frontend comparison table
`
--

## 2. Tech Stack (Defaults)

| Layer            | Choice                                       | Notes                                          |
| ---------------- | -------------------------------------------- | ---------------------------------------------- |
| Frontend         | React 18 + Vite + TypeScript + Tailwind CSS  | Chosen for speed and component ergonomics.     |
| UI components    | shadcn/ui + lucide-react icons               | Professional, accessible defaults.             |
| State management | React Context + `ueReducer` or Zustand)    | No Redux unless complexity demands it.         |
| Backend          | FastAPI (Python 3.11+)                       | Async, typed, OpenAPI docs out of the box.     |
| HTTP client      | `htpx` async) on backend, `ftch` n FE    |                                                |
| Salesforce SDK   | `smple-salesforce` *or** raw `htpx`      | `smple-salesforce` or productivity; raw httpx if you want full control over JWT flow. |
| LLM gateway      | OpenRouter API                               | Model is configurable via env var.             |
| Testing — FE     | Vitest + React Testing Library + Playwright  | Unit + component + E2E.                        |
| Testing — BE     | pytest + pytest-asyncio + httpx mock + responses | Unit + integration; Salesforce mocked.     |
| Linting          | ESLint + Prettier (FE), ruff + black (BE)    |                                                |
| Package mgmt     | pnpm (FE), uv or pip (BE)                    |                                                |

---

## 3. Repository Layout

`

oduct-compare/
├── claude.md                  # This file
├── README.md                  # Human-facing setup
├── .env.example               # All env vars documented
├── docker-compose.yml         # Optional: one-command local run
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/          # ChatWindow, MessageBubble, ChatInput
│   │   │   └── results/       # ComparisonTable, SourceBadge, RatingStars
│   │   ├── hooks/             # useChat, useProductSearch
│   │   ├── lib/               # api client, types, utils, source-theme
│   │   ├── pages/             # App.tsx, layout
│   │   └── styles/
│   ├── tests/
│   └── package.json
└── backend/
    ├── app/
    │   ├── main.py            # FastAPI entrypoint
    │   ├── routers/
    │   │   ├── chat.py        # /api/chat
    │   │   └── products.py    # /api/products/search
    │   ├── services/
    │   │   ├── openrouter.py  # LLM client
    │   │   ├── salesforce.py  # Auth + SOSL/SOQL client
    │   │   └── product_search.py # Orchestrates SF query + ranking
    │   ├── models/            # Pydantic schemas
    │   └── core/              # config, logging
    ├── tests/
    └── pyproject.toml
`
--

## 4. Frontend Specification

### 4.1 Layout

A two-pane responsive layout:

- Left pane (≈ 35–40% width on desktop):** Chat interface.
- Right pane (≈ 60–65% width on desktop):** A single **comparison table** that updates with each new search.
-  mobile: single column, table appears below the chat.

The visual treatment must feel professional and considered — not a generic AI-app template. Use whitespace generously, limit font weights, and pick one accent color plus the per-source colors below.

### 4.2 Chat UI Requirements

- stinct styling for user vs assistant messages (rounded bubbles, avatars, subtle shadow).
- ooth typing indicator (three-dot animation) while the backend is working.
- to-scroll to latest message; preserve scroll position when user scrolls up to read history.
- rkdown rendering in assistant messages (lists, bold, links).
- lti-line input with Enter to send, Shift+Enter for newline.
- sable input while a request is in flight; show a clear loading state.
- pty state with 2–3 example prompts ("Find me a gaming laptop under ₹80,000", etc.).
- rsistent chat history across the session (in-memory React state — **do not use localStorage** since artifacts/embedded contexts may forbid it).

### 4.3 Comparison Table — Catchy & Source-Differentiated

This is a key visual element. The table must make it **instantly obvious** which row belongs to which source.

**Per-source visual identity** (ship a `surce-theme.ts` ookup):

| Source     | Accent color  | Logo / chip                    | Row treatment                       |
| ---------- | ------------- | ------------------------------ | ----------------------------------- |
| Amazon     | `#F9900`    | Amazon logo or "A" monogram    | Left border 4px in accent color     |
| Flipkart   | `#874F0`    | Flipkart logo or "F" monogram  | Left border 4px in accent color     |
| Croma      | `#2714D`    | "Croma" wordmark               | Left border 4px in accent color     |
| Reliance Digital | `#40E20`  "RD" monogram               | Left border 4px in accent color     |
| (default)  | neutral gray  | first letter of source         | Left border 4px in accent color     |

Treatment rules:
- ch row carries a **left border** in the source accent color and a small **source chip** in the Source column with that color as background and white text.
- Group rows by source** with a subtle section header showing the source name + count ("Amazon — 3 results"). Within each group, sort by best match first.
- st-match row in each group gets a small "Top match" badge.
- bra striping is **off** (groups + accent borders carry the visual hierarchy).
- icky header. Numeric columns right-aligned. Currency localized to INR.
- scount % rendered as a green pill; rating rendered as filled stars + numeric value.
- pty state, loading skeleton (5 shimmer rows), and error state are all designed — not a fallback `<>Error</p>`.

**Columns** (drawn from `Poduct__c`  see §5.4):

| Column            | Source field          | Notes                                            |
| ----------------- | --------------------- | ------------------------------------------------ |
| Product name      | `title__c`           | Truncate with tooltip on overflow.               |
| Source            | `source__c`          | Colored chip, see above.                         |
| Current price     | `current_price__c`           | INR formatting.                                  |
| Original price    | `original_price__c`  | Strike-through if higher than current.           |
| Discount %        | `discount__c`        | Computed if not provided.                        |
| Rating            | `rating__c`          | Stars + numeric.                                 |
| Number of reviews | `review_count__c`    | Compact format (1.2k, 12k).                      |
| Rank              | `rank__c`            | Vendor's category rank if available.             |
| Link              | `product_url__c`             | "View" button opens in new tab.                  |


Salesforce product__c schema

availability	availability__c	Text(100)		False	
brand	brand__c	Text(100)		False	
Created By	CreatedById	Lookup(User)		False	
current_price	current_price__c	Number(16, 2)		False	
discount	discount__c	Percent(18, 0)		False	
image_url	image_url__c	URL(255)		False	
Last Modified By	LastModifiedById	Lookup(User)		False	
model	model__c	Text(100)		False	
original_price	original_price__c	Number(16, 2)		False	
Owner	OwnerId	Lookup(User,Group)		True	
product_url	product_url__c	URL(255)		False	
Products Name	Name	Auto Number		True	
rank	rank__c	Number(18, 0)		False	
rating	rating__c	Text(100)		False	
review_count	review_count__c	Number(18, 0)		False	
scraped_at	scraped_at__c	Text(100)		False	
source	source__c	Text(100)		False	
specifications	specifications__c	Text(100)		False	
title	title__c	Text(255) (External ID)

### 4.4 Frontend ↔ Backend Contract

- ST /api/chat`
 - **Body:** `{messages: ChatMessage[] }`  full conversation history each call (LLM is stateless).
  - **Response:** `{reply: string, productQuery: ProductQuery | null }`
 - If `poductQuery` s non-null, frontend immediately calls `/pi/products/search` ith it.
- ST /api/products/search`
 - **Body:** `PoductQuery` see §5.6).
  - **Response:** `{results: ProductListing[] }`  top 3 per source, UI handles grouping.

---

## 5. Backend Specification

### 5.1 Responsibilities

1. Accept chat messages from the frontend.
2. Forward conversation history to the configured OpenRouter model with tool calling.
3. When the model emits a `PoductQuery`,query Salesforce's `Poduct__c` bject.
4. Match `Ttle__c` gainst the user input, return the **top 3 best-matched records per `Surce__c`*.
5. Normalize Salesforce records into the `PoductListing` chema and return them.

### 5.2 OpenRouter Integration *(nchanged)*

- dpoint: `https://openrouter.ai/api/v1/chat/completions`.
- th: `Athorization: Bearer ${OPENROUTER_API_KEY}` env var).
- del: configurable via `OENROUTER_MODEL` e.g., `athropic/claude-3.5-sonnet`,`oenai/gpt-4o`,`mta-llama/llama-3.3-70b-instruct`)
- Always** pass the full prior conversation in `mssages`  the LLM has no memory between calls.
- e **function/tool calling** so the model returns a structured `PoductQuery` ather than free-form text the backend has to parse with regex.

**System prompt outline** (refine during build):
> Yu are a helpful shopping assistant. When the user describes a product they want to compare or buy, call the `serch_products` tol with the structured query. Otherwise, reply conversationally to clarify what they're looking for. Never invent prices or ratings.

### 5.3 Salesforce Integration

#### 5.3.1 Authentication — OAuth 2.0 Client Credentials Flow

Server-to-server, no interactive login, no per-user JWT signing. Simpler than JWT for backend services where a single integration identity is acceptable.

Required setup in Salesforce:
- A*Connected App** with **"Enable Client Credentials Flow"** turned on (under OAuth Policies).
- Oth scope: `ap` (dd `reresh_token` oly if you also need refresh tokens — Client Credentials typically does not).
- A*"Run As" user** assigned to the Connected App (this is the integration identity all calls run as).
- Csumer Key + Consumer Secret captured securely.

Backend flow:
1. POST to `https://login.salesforce.com/services/oauth2/token` (or your My Domain URL) with:
   ```
grant_type=client_credentials
   client_id=<consumer key>
   client_secret=<consumer secret>
   ```

`Cotent-Type: application/x-www-form-urlencoded`.
. Response returns `acess_token` +`intance_url`. ache them in memory until ~5 min before expiry, then refresh by repeating step 1.
3. All subsequent API calls go to `<istance_url>/services/data/vXX.0/...` wth `Auhorization: Bearer <access_token>`.
. On a 401 from any data API call, invalidate the cache, request a new token once, and retry the original call. If it still fails, surface the error.

**Security notes:**
Store SF_CLIENT_SECRET in env vars or a secrets manager — never commit it.
Never log the secret, the token, or the full Authorization header.
For production, prefer a My Domain URL (https://<your-domain>.my.salesforce.com) over login.salesforce.com.

#### 5.3.2 Querying Product__c — match on Title__c

**Strategy: SOQL with LIKE (substring match).** Simple, predictable, and good enough for the matching quality this app needs. We pull more records than we need, then rank and slice in Python.

**SOQL query template** (parameterized — do **not** string-concatenate user input directly):
sql
SELECT Id, Name, Title__c, Source__c, Price__c, Original_Price__c,
       Discount__c, Rating__c, Review_Count__c, Rank__c, URL__c, Image_URL__c
FROM Product__c
WHERE Title__c LIKE :likePattern
  AND Source__c != null
ORDER BY Source__c ASC, Rating__c DESC NULLS LAST, Review_Count__c DESC NULLS LAST
LIMIT 200

…where likePattern = f"%{escape_soql(user_query)}%".

**Escaping is mandatory.** escape_soql must backslash-escape \, ', %, and _ in that order (escape \ first to avoid double-escaping). Reject empty or whitespace-only queries with a 400 before hitting Salesforce.

**Optional improvement — token-AND match.** If a single substring like %iphone 15 pro% is too restrictive (the user's word order won't match the title's), split the input into tokens and AND them:
sql
WHERE Title__c LIKE :p1 AND Title__c LIKE :p2 AND Title__c LIKE :p3

Cap at 5 tokens to keep query length sane. Document whichever variant ships.

**Ranking and top-3-per-source happens in Python**, not SOQL (Salesforce has no per-group LIMIT):

1. Group results by Source__c.
2. Within each group, score each record by how well Title__c matches the user input. A simple, dependency-free score that works well:
   - +10 if the full query appears as a substring in Title__c (case-insensitive).
   - +1 per matching token (whole-word match, case-insensitive).
   - Tie-break by Rating__c desc, then Review_Count__c desc.
3. Keep the top 3 per group. If a source has fewer than 3 matches, return what's available — don't pad.
4. Return the flat list of ProductListing[].

#### 5.3.3 Pagination & limits

Product__c may have many rows per source. Always cap with LIMIT 200 on the SF side, then rank and filter to top 3 per source in Python. If a source has fewer than 3 matches, return what's available — don't pad.

### 5.4 Product__c — Assumed Schema

These are the fields the backend expects. **Confirm with the Salesforce admin before coding** — adjust this section and the SOSL/SOQL templates if anything is named differently.

availability	availability__c	Text(100)		False	
brand	brand__c	Text(100)		False	
Created By	CreatedById	Lookup(User)		False	
current_price	current_price__c	Number(16, 2)		False	
discount	discount__c	Percent(18, 0)		False	
image_url	image_url__c	URL(255)		False	
Last Modified By	LastModifiedById	Lookup(User)		False	
model	model__c	Text(100)		False	
original_price	original_price__c	Number(16, 2)		False	
Owner	OwnerId	Lookup(User,Group)		True	
product_url	product_url__c	URL(255)		False	
Products Name	Name	Auto Number		True	
rank	rank__c	Number(18, 0)		False	
rating	rating__c	Text(100)		False	
review_count	review_count__c	Number(18, 0)		False	
scraped_at	scraped_at__c	Text(100)		False	
source	source__c	Text(100)		False	
specifications	specifications__c	Text(100)		False	
title	title__c	Text(255) (External ID)

### 5.5 Configuration

All config via environment variables, documented in .env.example:
# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-oss-120b

# Salesforce (OAuth 2.0 Client Credentials Flow)
SF_LOGIN_URL=https://login.salesforce.com    # or https://<your-domain>.my.salesforce.com
SF_CLIENT_ID=                  # Connected App consumer key
SF_CLIENT_SECRET=              # Connected App consumer secret — keep secret
SF_API_VERSION=60.0
SF_QUERY_LIMIT=200             # SOQL cap
SF_RESULTS_PER_SOURCE=3        # Top N per source returned to FE

# App
CORS_ALLOW_ORIGINS=http://localhost:5173
LOG_LEVEL=INFO

Never hard-code secrets. Never log access tokens, the client secret, or the full Authorization header. Redact tokens in error messages.

### 5.6 Schemas (Pydantic / TypeScript)
python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

class ProductQuery(BaseModel):
    query: str                         # raw search string, e.g. "iPhone 15 Pro 256GB"
    category: str | None = None        # "mobile", "laptop", etc.
    min_price: float | None = None
    max_price: float | None = None
    brand: str | None = None
    sources: list[str] | None = None   # restrict to ["Amazon", "Flipkart"] etc.


---

## 6. Testing Requirements

**Non-negotiable: every module ships with tests, and the full test suite must pass before the app is declared ready.**

### 6.1 Backend tests (pytest)

**Unit tests** for every service function:
  - openrouter.py: mock the HTTP layer, assert request shape, assert tool-call parsing, assert error handling for 4xx/5xx/timeouts.
  - salesforce.py:
    - Token request sends grant_type=client_credentials with the configured client id/secret in the form body.
    - Successful auth caches access_token and instance_url; subsequent calls reuse the cache.
    - Token refresh is triggered when the cached token nears expiry.
    - SOQL LIKE escaping covers \, ', %, _ and is order-correct (parameterized test).
    - Empty or whitespace-only input is rejected before the SF call.
    - 401 from Salesforce triggers a single token refresh + retry, then surfaces.
    - 5xx and network errors retry once, then surface a clean error.
    - Client secret never appears in logs or exception messages (assert via captured logs).
  - product_search.py:
    - Groups results by Source__c correctly.
    - Returns at most 3 per source.
    - Ranking score: full-query substring match outranks token matches; ties broken by rating desc, then review count desc.
    - Computes discount_percent when Original_Price__c is present and Discount__c is null.
    - Handles missing optional fields without crashing.
    - When a source has fewer than 3 matches, returns what's available (no padding).
**Schema tests:** every Pydantic model has a roundtrip test and at least one validation-failure test.
**Router tests** (using FastAPI TestClient): /api/chat and /api/products/search for success, validation errors, and upstream failures.
**Integration test:** end-to-end with both LLM and Salesforce mocked, asserting that a user message like "find me a OnePlus 12" produces a normalized ProductListing[] with at most 3 entries per source.
**Fixtures:** at least 3 sample Salesforce responses (happy path, partial fields, empty result) live under tests/fixtures/salesforce/.
Coverage target: **≥ 85%** on app/services and app/routers.

### 6.2 Frontend tests (Vitest + React Testing Library)

Component tests for ChatWindow, MessageBubble, ChatInput, ComparisonTable, SourceBadge, and the loading/empty/error states of each.
Hook tests for useChat and useProductSearch (mock fetch).
Visual contract tests for source theming: every supported source resolves to its expected accent color and chip label.
Snapshot tests are allowed but must not be the only assertion.

### 6.3 End-to-end tests (Playwright)

At minimum:
1. User types a product query → assistant replies → table renders with mocked data, grouped by source, max 3 rows per source.
2. Each source's rows show its accent color and chip.
3. Backend error → user sees a friendly error in chat, no broken UI.
4. Empty results → "No products found" state renders correctly.
5. Sorting and viewing a product link in the results table.

### 6.4 Definition of "ready"

The app is considered ready only when:
pytest passes with coverage ≥ 85% on the targeted modules.
vitest run passes with no failing tests.
playwright test passes all E2E specs against a locally running stack (Salesforce mocked).
ruff, black --check, eslint, and tsc --noEmit all pass with zero errors.
Manual smoke test against a real Salesforce sandbox: chat works, query returns a grouped table, errors are handled gracefully, the access token refreshes correctly when it expires.

---

## 7. Coding Standards

**Type everything.** No any in TypeScript, no untyped function signatures in Python.
Prefer pure functions and small modules; keep components under ~150 lines.
Error handling is explicit — never swallow exceptions silently; log with context.
All user-facing strings live in one place per app (frontend/src/lib/strings.ts) so they can be edited without hunting through components.
Per-source visuals live in frontend/src/lib/source-theme.ts so adding a new source is a one-file change.
Accessibility: semantic HTML, keyboard navigation in the chat and tables, ARIA labels on icon-only buttons, sufficient color contrast (verify each source accent color meets AA against the chip's white text).

---

## 8. Build Order (recommended)

1. Scaffold both apps; confirm pnpm dev and uvicorn app.main:app --reload run side-by-side.
2. Define schemas (§5.6) in both languages; generate or hand-write TS types from Pydantic.
3. Build services/salesforce.py (Client Credentials auth + token cache + SOQL helpers) against mocked HTTP + tests.
4. Build services/product_search.py (ranking, grouping, top-3-per-source) + tests.
5. Build services/openrouter.py with tool calling + tests.
6. Wire up /api/chat and /api/products/search + router tests.
7. Build the chat UI shell with mocked responses.
8. Build the source theme + ComparisonTable with grouped rows and accent borders.
9. Connect frontend to backend; verify the full loop with mocks.
10. Swap mocks for the real OpenRouter and a Salesforce sandbox; tune the system prompt and SOQL query.
11. Write E2E tests; run the full quality gate from §6.4.
12. Polish: empty/error/loading states, animations, accessibility pass.

---
