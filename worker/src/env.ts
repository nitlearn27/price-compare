/**
 * Cloudflare Worker bindings. Every var/secret arrives as a string; typed
 * parsing + defaults live in `lib/config.ts` (mirrors the Python `Settings`).
 */
export interface Env {
  // Bindings
  ASSETS: Fetcher;
  // Optional: cross-turn agent state. Absent ⇒ the agent runs stateless (every
  // turn independent). Create it with `wrangler kv namespace create AGENT_STATE`
  // and add the binding to wrangler.jsonc to enable persistence.
  AGENT_STATE?: KVNamespace;

  // Salesforce
  SF_TOKEN_URL: string;
  SF_CLIENT_ID: string; // secret
  SF_CLIENT_SECRET: string; // secret
  SF_API_VERSION: string;
  SF_QUERY_LIMIT: string;
  SF_RESULTS_PER_SOURCE: string;

  // Chat/agent models
  DEEPSEEK_API_KEY: string; // secret
  DEEPSEEK_MODEL: string;
  DEEPSEEK_BASE_URL: string;
  OPENROUTER_API_KEY: string; // secret
  OPENROUTER_MODEL: string;
  OPENROUTER_FALLBACK_MODEL: string;

  // Vision (photo identify)
  GEMINI_API_KEY: string; // secret
  GEMINI_MODEL: string;

  // Agent guardrails + checkpointer
  AGENT_MAX_STEPS: string;
  AGENT_MAX_OUTPUT_TOKENS: string;
  AGENT_TOKEN_BUDGET: string;
  AGENT_MAX_TOOL_CALLS_PER_STEP: string;
  AGENT_HISTORY_LIMIT: string;
  AGENT_CHECKPOINTER: string; // "kv" | "memory" | "none"
  AGENT_VALIDATE_RELEVANCE: string; // "true" | "false" — LLM relevance pass

  // Aggregator
  AGGREGATOR_SPOKE_TIMEOUT: string;
  AGGREGATOR_ENRICH_HISTORY: string;
  AGGREGATOR_HISTORY_DAYS: string;
  AGGREGATOR_MIN_CATALOG_RESULTS: string;

  // Live spokes + refresh
  SEARCH_PRODUCT_FLIPKART_URL: string;
  SEARCH_PRODUCT_AMAZON_URL: string;
  REFRESH_AMAZON_URL: string;
  REFRESH_FLIPKART_URL: string;
  REFRESH_ORDERS: string;

  // Recommendations, cart, otp
  RECOMMENDATION_API_URL: string;
  RECOMMENDATION_CACHE_TTL_SECONDS: string;
  FLIPKART_ADD_CART_URL: string;
  AMAZON_ADD_CART_URL: string;
  OTP_API_URL: string;

  // App
  CORS_ALLOW_ORIGINS: string;
}
