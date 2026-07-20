import type { Env } from "../env";

/** Typed, parsed settings — the TS analogue of the Python pydantic `Settings`.
 * Every binding arrives as a string; we coerce with defaults here. */
export interface Settings {
  sfTokenUrl: string;
  sfClientId: string;
  sfClientSecret: string;
  sfApiVersion: string;
  sfQueryLimit: number;
  sfResultsPerSource: number;

  openrouterApiKey: string;
  openrouterModel: string;
  openrouterFallbackModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  geminiApiKey: string;
  geminiModel: string;

  agentMaxSteps: number;
  agentMaxOutputTokens: number;
  agentTokenBudget: number;
  agentMaxToolCallsPerStep: number;
  agentHistoryLimit: number;
  agentCheckpointer: string;
  agentValidateRelevance: boolean;

  aggregatorSpokeTimeout: number; // seconds
  aggregatorEnrichHistory: boolean;
  aggregatorHistoryDays: number;
  aggregatorMinCatalogResults: number;

  searchProductFlipkartUrl: string;
  searchProductAmazonUrl: string;
  refreshAmazonUrl: string;
  refreshFlipkartUrl: string;
  refreshOrders: number;

  recommendationApiUrl: string;
  recommendationCacheTtlSeconds: number;
  flipkartAddCartUrl: string;
  amazonAddCartUrl: string;
  otpApiUrl: string;

  corsAllowOrigins: string;

  /** Scheme+host of the Salesforce token URL (the REST instance base). */
  sfInstanceUrl: string;
}

function str(v: string | undefined, dflt = ""): string {
  return v === undefined || v === "" ? dflt : v;
}
function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function instanceUrl(tokenUrl: string): string {
  try {
    const u = new URL(tokenUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export function loadSettings(env: Env): Settings {
  return {
    sfTokenUrl: str(env.SF_TOKEN_URL, "https://login.salesforce.com/services/oauth2/token"),
    sfClientId: str(env.SF_CLIENT_ID),
    sfClientSecret: str(env.SF_CLIENT_SECRET),
    sfApiVersion: str(env.SF_API_VERSION, "57.0"),
    sfQueryLimit: num(env.SF_QUERY_LIMIT, 200),
    sfResultsPerSource: num(env.SF_RESULTS_PER_SOURCE, 3),

    openrouterApiKey: str(env.OPENROUTER_API_KEY),
    openrouterModel: str(env.OPENROUTER_MODEL, "openai/gpt-oss-120b"),
    openrouterFallbackModel: str(env.OPENROUTER_FALLBACK_MODEL, "openrouter/free"),
    deepseekApiKey: str(env.DEEPSEEK_API_KEY),
    deepseekModel: str(env.DEEPSEEK_MODEL, "deepseek-v4-flash"),
    deepseekBaseUrl: str(env.DEEPSEEK_BASE_URL, "https://api.deepseek.com/v1/chat/completions"),
    geminiApiKey: str(env.GEMINI_API_KEY),
    geminiModel: str(env.GEMINI_MODEL, "gemini-2.5-flash"),

    agentMaxSteps: num(env.AGENT_MAX_STEPS, 6),
    agentMaxOutputTokens: num(env.AGENT_MAX_OUTPUT_TOKENS, 1024),
    agentTokenBudget: num(env.AGENT_TOKEN_BUDGET, 20000),
    agentMaxToolCallsPerStep: num(env.AGENT_MAX_TOOL_CALLS_PER_STEP, 4),
    agentHistoryLimit: num(env.AGENT_HISTORY_LIMIT, 30),
    agentCheckpointer: str(env.AGENT_CHECKPOINTER, "kv"),
    agentValidateRelevance: bool(env.AGENT_VALIDATE_RELEVANCE, true),

    aggregatorSpokeTimeout: num(env.AGGREGATOR_SPOKE_TIMEOUT, 90),
    aggregatorEnrichHistory: bool(env.AGGREGATOR_ENRICH_HISTORY, true),
    aggregatorHistoryDays: num(env.AGGREGATOR_HISTORY_DAYS, 90),
    aggregatorMinCatalogResults: num(env.AGGREGATOR_MIN_CATALOG_RESULTS, 3),

    searchProductFlipkartUrl: str(env.SEARCH_PRODUCT_FLIPKART_URL),
    searchProductAmazonUrl: str(env.SEARCH_PRODUCT_AMAZON_URL),
    refreshAmazonUrl: str(env.REFRESH_AMAZON_URL),
    refreshFlipkartUrl: str(env.REFRESH_FLIPKART_URL),
    refreshOrders: num(env.REFRESH_ORDERS, 2),

    recommendationApiUrl: str(
      env.RECOMMENDATION_API_URL,
      "https://insight-generation-production.up.railway.app/api/insights/next-purchase",
    ),
    recommendationCacheTtlSeconds: num(env.RECOMMENDATION_CACHE_TTL_SECONDS, 3600),
    flipkartAddCartUrl: str(
      env.FLIPKART_ADD_CART_URL,
      "https://purchase-history-production.up.railway.app/api/cart",
    ),
    amazonAddCartUrl: str(env.AMAZON_ADD_CART_URL),
    otpApiUrl: str(env.OTP_API_URL, "https://amazon-fresh-history-production.up.railway.app/api/otp"),

    corsAllowOrigins: str(env.CORS_ALLOW_ORIGINS, "http://localhost:5173"),

    sfInstanceUrl: instanceUrl(str(env.SF_TOKEN_URL, "https://login.salesforce.com")),
  };
}
