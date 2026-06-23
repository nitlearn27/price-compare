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

    # Product refresh triggers (fire-and-forget, no auth)
    refresh_amazon_url: str = ""
    refresh_flipkart_url: str = ""
    refresh_orders: int = 2  # POST body: {"orders": <n>}

    # Flipkart live keyword search — fallback when the Salesforce catalog is empty.
    # External service: GET ?name=<product> → Flipkart products as JSON.
    search_product_flipkart_url: str = ""

    # Recommendation engine ("next purchase" insights) — external service
    recommendation_api_url: str = (
        "https://insight-generation-production.up.railway.app/api/insights/next-purchase"
    )

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
