from functools import lru_cache
from urllib.parse import urlparse

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Salesforce — names match the existing .env file
    sf_token_url: str = "https://login.salesforce.com/services/oauth2/token"
    sf_client_id: str = ""
    sf_client_secret: str = ""
    sf_api_version: str = "57.0"
    sf_query_limit: int = 200
    sf_results_per_source: int = 3

    # OpenRouter
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-oss-120b"

    # DeepSeek (primary chat/agent model — OpenAI-compatible API)
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com/v1/chat/completions"

    # Agent guardrails — keep the tool-use loop bounded in steps and tokens
    agent_max_steps: int = 6  # max loop iterations
    agent_max_output_tokens: int = 1024  # max_tokens per model call
    agent_token_budget: int = 20000  # stop looping once cumulative usage exceeds this
    agent_max_tool_calls_per_step: int = 4
    agent_history_limit: int = 30  # cap items returned by get_purchase_history

    # Hub-spoke aggregator — per-spoke wall-clock timeout (seconds). A slow source
    # is dropped after this so it can't block the others. Live store scrapes
    # (login + visiting several product pages) routinely take 30-60s, so this must
    # be generous; kept under the Flipkart httpx read timeout (120s).
    aggregator_spoke_timeout: float = 90.0
    # Annotate live results (e.g. Flipkart) with the user's purchase history.
    aggregator_enrich_history: bool = True
    aggregator_history_days: int = 90  # look-back window for the history map
    # Tiered fan-out: query the catalog (Salesforce) first; for each live source
    # (Flipkart, Amazon) hit its website only when the catalog returned FEWER than
    # this many results FOR THAT SOURCE. Default 1 = skip a source's live call
    # whenever the catalog already has at least one product from it.
    aggregator_min_catalog_results: int = 1

    # Product refresh triggers (fire-and-forget, no auth)
    refresh_amazon_url: str = ""
    refresh_flipkart_url: str = ""
    refresh_orders: int = 2  # POST body: {"orders": <n>}

    # Flipkart live keyword search — fallback when the Salesforce catalog is empty.
    # External service: GET ?name=<product> → Flipkart products as JSON.
    search_product_flipkart_url: str = ""

    # Amazon live keyword search — fallback when the Salesforce catalog is empty.
    # External service: GET ?q=<product> → Amazon products as JSON.
    search_product_amazon_url: str = ""

    # Recommendation engine ("next purchase" insights) — external service
    recommendation_api_url: str = (
        "https://insight-generation-production.up.railway.app/api/insights/next-purchase"
    )
    # Cache the engine's response this long so we don't call it on every app open.
    recommendation_cache_ttl_seconds: int = 3600  # 1 hour

    # Cart checkout (bulk order submission) — external purchasing apps
    cart_flipkart_url: str = "https://purchase-history-production.up.railway.app/api/cart"
    cart_amazon_url: str = ""  # to be wired later

    # OTP submission — external service. Triggered by the "otp <number>" chat keyword.
    otp_api_url: str = "https://amazon-fresh-history-production.up.railway.app/api/otp"

    # App
    cors_allow_origins: str = "http://localhost:5173"
    log_level: str = "INFO"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    openrouter_fallback_model: str = "openrouter/free"

    @property
    def sf_instance_url(self) -> str:
        parsed = urlparse(self.sf_token_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    model_config = {
        "env_file": ("../.env", ".env"),
        "extra": "ignore",
        "case_sensitive": False,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
