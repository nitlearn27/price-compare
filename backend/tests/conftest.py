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
        refresh_amazon_url="https://refresh.test/amazon",
        refresh_flipkart_url="https://refresh.test/flipkart",
        refresh_orders=2,
        otp_api_url="https://otp.test/api/otp",
        search_product_flipkart_url="https://flipkart.test/search",
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

    sf_mod.salesforce_client._settings = test_settings
    or_mod.openrouter_client._settings = test_settings
    rp_mod  # imported to ensure patching chain works

    yield

    get_settings.cache_clear()


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
