# Architecture — Price Compare

High-level view of how a request flows from the browser, through the backend's
router and service layers, out to the external systems the app integrates with.
All searching happens inside the LangGraph agent (`/api/agent/chat[/stream]`);
the only other product endpoint is the phase-2 `/api/products/live` fetch.

```mermaid
flowchart TD
    subgraph Browser["Browser — React 18 + Vite SPA"]
        UI_Chat["Chat UI"]
        UI_Results["Comparison / Results pane"]
        UI_Cart["Cart"]
        UI_Recs["Recommendations"]
        UI_Refresh["Refresh"]
        API["lib/api.ts — HTTP client<br/>(useChat, useProductSearch,<br/>useRecommendations, useCart, useRefresh)"]
        UI_Chat --> API
        UI_Results --> API
        UI_Cart --> API
        UI_Recs --> API
        UI_Refresh --> API
    end

    subgraph Backend["Backend — routes under /api (Python reference · TS worker in prod)"]
        direction TB
        subgraph Routers["Router layer"]
            R_agent["agent.py<br/>POST /agent/chat<br/>POST /agent/chat/stream (SSE)"]
            R_identify["identify.py<br/>POST /identify"]
            R_products["products.py<br/>POST /products/live"]
            R_recs["recommendations.py<br/>POST /recommendations/next-purchase"]
            R_cart["cart.py<br/>POST /cart/checkout"]
            R_orders["orders.py<br/>POST /products/refresh<br/>POST /otp"]
        end
        subgraph Services["Service layer"]
            S_agent["agent + agent_graph<br/>(LangGraph StateGraph)"]
            S_agg["aggregator<br/>(hub-spoke)"]
            S_gemini["gemini"]
            S_salesforce["salesforce"]
            S_psearch["product_search<br/>(rank + group)"]
            S_live["flipkart_search /<br/>amazon_search"]
            S_recs["recommendations"]
            S_cart["cart"]
            S_refresh["refresh"]
            S_otp["otp"]
        end
    end

    subgraph External["External systems"]
        X_LLM(["DeepSeek LLM<br/>(OpenRouter fallback)"])
        X_Gem(["Google Gemini — vision"])
        X_SF[("Salesforce<br/>Grocery_Product__c")]
        X_Store(["Flipkart / Amazon live search"])
        X_Vendor(["Vendor automation webhooks<br/>cart · refresh · OTP"])
    end

    %% Browser -> routers
    API --> R_agent
    API --> R_identify
    API --> R_products
    API --> R_recs
    API --> R_cart
    API --> R_orders

    %% agent: deterministic "otp <number>" short-circuit before the LLM
    R_agent -.->|"'otp NNNN' short-circuit"| S_otp
    R_agent --> S_agent
    S_agent --> S_agg
    S_agent --> S_cart
    S_agent --> S_refresh
    S_agg --> S_salesforce
    S_agg --> S_live
    S_salesforce --> S_psearch

    %% identify (image)
    R_identify --> S_gemini
    R_identify --> S_salesforce
    R_identify --> S_psearch

    %% phase-2 live rows
    R_products --> S_agg

    %% recommendations / cart / orders
    R_recs --> S_recs
    R_cart --> S_cart
    R_orders --> S_refresh
    R_orders --> S_otp

    %% services -> external
    S_agent --> X_LLM
    S_gemini --> X_Gem
    S_gemini -.->|fallback| X_LLM
    S_recs --> X_LLM
    S_salesforce --> X_SF
    S_live --> X_Store
    S_cart --> X_Vendor
    S_refresh --> X_Vendor
    S_otp --> X_Vendor
```

## External systems

| System | Used by | Purpose |
| --- | --- | --- |
| **DeepSeek** (OpenRouter fallback) | `agent`, `cart` (name resolution), `gemini` (fallback) | Chat completions + tool calling for the agent loop |
| **Google Gemini** (`generativelanguage.googleapis.com`) | `gemini` | Identify products from an uploaded image |
| **Salesforce** (OAuth client-credentials + SOQL) | `salesforce` | Catalog of past purchases — `Grocery_Product__c` |
| **Flipkart / Amazon live search** (`SEARCH_PRODUCT_*_URL`) | `flipkart_search`, `amazon_search` | Live store rows for sources the catalog didn't cover |
| **Vendor automation webhooks** | `cart`, `refresh`, `otp` | Cart checkout, order refresh, OTP submission |

## Deployment

The app deploys to **Cloudflare Workers** (`worker/` — Hono + `@langchain/langgraph`,
TypeScript): same `/api/*` contract, SPA served as Workers static assets. Live at
`https://price-compare.nit4infy1.workers.dev`.

Workers can't run the Python app (V8 isolates — no `uvicorn` / native
`pydantic-core`/`orjson`/langgraph wheels), so `worker/` is a TypeScript
reimplementation with behavioral parity. It bundles to ~490 KiB gzipped. Cross-turn
agent state is KV-backed there (no in-process checkpointer on ephemeral isolates).
The Python `backend/` remains the reference implementation and local-dev server;
it is not deployed.

## Notes

- In local dev the Vite dev server proxies `/api/*` to the backend (`:8000` for
  the Python app, or run `worker && pnpm dev` to serve API + built SPA on `:8787`).
- The `otp <number>` path in `agent.py` is handled deterministically **before**
  the LLM, so the model never sees or invents OTP codes.
- `product_search` is pure ranking/grouping logic — it has no external calls; it
  shapes Salesforce (and image-identify) records into the response.
