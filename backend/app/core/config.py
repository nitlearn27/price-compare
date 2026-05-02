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

    # App
    cors_allow_origins: str = "http://localhost:5173"
    log_level: str = "INFO"

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
