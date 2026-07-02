import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures" / "salesforce"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(autouse=True)
def override_settings(monkeypatch):
    """Inject test-safe settings so no real credentials are needed."""
    test_settings = Settings(
        sf_token_url="https://test.salesforce.com/services/oauth2/token",
        sf_client_id="test_client_id",
        sf_client_secret="test_client_secret_value_here",
        sf_api_version="57.0",
        sf_query_limit=200,
        sf_results_per_source=3,
        openrouter_api_key="test_openrouter_key",
        openrouter_model="openai/gpt-4o",
        deepseek_api_key="test_deepseek_key",
        deepseek_model="deepseek-test",
        refresh_amazon_url="https://refresh.test/amazon",
        refresh_flipkart_url="https://refresh.test/flipkart",
        refresh_orders=2,
        otp_api_url="https://otp.test/api/otp",
        flipkart_add_cart_url="https://purchase-history-production.up.railway.app/api/cart",
        amazon_add_cart_url="https://amazon.test/api/cart",
        search_product_flipkart_url="https://flipkart.test/search",
        search_product_amazon_url="https://amazon.test/search",
        recommendation_api_url="https://insight-generation-production.up.railway.app/api/insights/next-purchase",
        cors_allow_origins="http://localhost:5173",
        log_level="DEBUG",
    )
    get_settings.cache_clear()
    monkeypatch.setattr("app.core.config.get_settings", lambda: test_settings)

    # Patch settings in all service modules that cache it
    import app.routers.products as rp_mod
    import app.services.openrouter as or_mod
    import app.services.product_search as ps_mod  # noqa: F401
    import app.services.salesforce as sf_mod
    import app.services.cart as cart_mod

    sf_mod.salesforce_client._settings = test_settings
    or_mod.openrouter_client._settings = test_settings
    monkeypatch.setattr(cart_mod, "get_settings", lambda: test_settings)
    rp_mod  # imported to ensure patching chain works

    yield

    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _clear_recommendation_cache():
    """The next-purchase cache is module-level state; reset it around each test."""
    import app.services.recommendations as rec_mod

    rec_mod._cache.clear()
    yield
    rec_mod._cache.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def happy_path_records():
    return load_fixture("happy_path.json")["records"]


@pytest.fixture
def partial_records():
    return load_fixture("partial_fields.json")["records"]


@pytest.fixture
def empty_records():
    return load_fixture("empty_result.json")["records"]
