import logging
import time

import httpx
import pytest
import respx

from app.core.config import Settings
from app.services.salesforce import SalesforceClient, escape_soql

# ── escape_soql ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("hello", "hello"),
        ("it's", "it\\'s"),
        ("50%", "50\\%"),
        ("wild_card", "wild\\_card"),
        ("back\\slash", "back\\\\slash"),
        # Order: \ first, then ', %, _
        ("\\'%_", "\\\\\\'\\%\\_"),
    ],
)
def test_escape_soql(raw, expected):
    assert escape_soql(raw) == expected


def test_escape_soql_empty():
    assert escape_soql("") == ""


# ── token acquisition ─────────────────────────────────────────────────────────

TEST_TOKEN_URL = "https://test.salesforce.com/services/oauth2/token"
TEST_INSTANCE_URL = "https://test.salesforce.com"
TEST_QUERY_URL = f"{TEST_INSTANCE_URL}/services/data/v57.0/query"

TEST_SETTINGS = Settings(
    sf_token_url=TEST_TOKEN_URL,
    sf_client_id="test_client_id",
    sf_client_secret="test_client_secret_value_here",
    sf_api_version="57.0",
    sf_query_limit=200,
    sf_results_per_source=3,
    openrouter_api_key="test_key",
    openrouter_model="openai/gpt-4o",
    cors_allow_origins="http://localhost:5173",
    log_level="DEBUG",
)


@pytest.fixture
def sf():
    client = SalesforceClient()
    # Inject test settings directly so no real SF credentials are used
    client._settings = TEST_SETTINGS
    client._access_token = None
    client._instance_url = None
    client._expires_at = 0.0
    return client


TOKEN_RESPONSE = {
    "access_token": "mock_access_token_abc",
    "instance_url": TEST_INSTANCE_URL,
    "token_type": "Bearer",
    "expires_in": 7200,
}

QUERY_RESPONSE = {
    "totalSize": 1,
    "done": True,
    "records": [
        {
            "Id": "aaa",
            "Name": "P-001",
            "Title__c": "OnePlus 12",
            "Source__c": "Amazon",
            "Current_Price__c": 60000,
            "Original_Price__c": 70000,
            "Discount__c": None,
            "Rating__c": "4.5",
            "Review_Count__c": 1000,
            "Rank__c": 1,
            "Product_URL__c": None,
            "Image_URL__c": None,
            "Availability__c": "In Stock",
        }
    ],
}


@pytest.mark.asyncio
async def test_token_request_sends_client_credentials(sf):
    with respx.mock:
        token_route = respx.post(TEST_TOKEN_URL).mock(
            return_value=httpx.Response(200, json=TOKEN_RESPONSE)
        )
        query_route = respx.get(TEST_QUERY_URL).mock(
            return_value=httpx.Response(200, json=QUERY_RESPONSE)
        )

        await sf.search_products("OnePlus 12")

    assert token_route.called
    request = token_route.calls[0].request
    body = dict(pair.split("=") for pair in request.content.decode().split("&"))
    assert body["grant_type"] == "client_credentials"
    assert body["client_id"] == "test_client_id"
    assert body["client_secret"] == "test_client_secret_value_here"
    assert query_route.called


@pytest.mark.asyncio
async def test_token_is_cached_on_subsequent_calls(sf):
    with respx.mock:
        token_route = respx.post(TEST_TOKEN_URL).mock(
            return_value=httpx.Response(200, json=TOKEN_RESPONSE)
        )
        respx.get(TEST_QUERY_URL).mock(return_value=httpx.Response(200, json=QUERY_RESPONSE))

        await sf.search_products("OnePlus 12")
        await sf.search_products("OnePlus 12")

    # Token must only be fetched once
    assert token_route.call_count == 1


@pytest.mark.asyncio
async def test_token_refresh_when_near_expiry(sf):
    with respx.mock:
        token_route = respx.post(TEST_TOKEN_URL).mock(
            return_value=httpx.Response(200, json=TOKEN_RESPONSE)
        )
        respx.get(TEST_QUERY_URL).mock(return_value=httpx.Response(200, json=QUERY_RESPONSE))

        # Pre-load a token that is about to expire
        sf._access_token = "old_token"
        sf._instance_url = "https://test.salesforce.com"
        sf._expires_at = time.monotonic() - 1  # already expired

        await sf.search_products("OnePlus 12")

    assert token_route.call_count == 1  # refreshed


@pytest.mark.asyncio
async def test_401_triggers_single_token_refresh(sf):
    with respx.mock:
        respx.post(TEST_TOKEN_URL).mock(return_value=httpx.Response(200, json=TOKEN_RESPONSE))
        query_route = respx.get(TEST_QUERY_URL).mock(
            side_effect=[
                httpx.Response(401, json={"error": "INVALID_SESSION_ID"}),
                httpx.Response(200, json=QUERY_RESPONSE),
            ]
        )

        await sf.search_products("OnePlus 12")

    assert query_route.call_count == 2  # first 401 + retry


@pytest.mark.asyncio
async def test_second_401_raises(sf):
    with respx.mock:
        respx.post(TEST_TOKEN_URL).mock(return_value=httpx.Response(200, json=TOKEN_RESPONSE))
        respx.get(TEST_QUERY_URL).mock(
            return_value=httpx.Response(401, json={"error": "INVALID_SESSION_ID"})
        )

        with pytest.raises(httpx.HTTPStatusError):
            await sf.search_products("OnePlus 12")


@pytest.mark.asyncio
async def test_5xx_raises(sf):
    with respx.mock:
        respx.post(TEST_TOKEN_URL).mock(return_value=httpx.Response(200, json=TOKEN_RESPONSE))
        respx.get(TEST_QUERY_URL).mock(
            return_value=httpx.Response(503, json={"error": "SERVICE_UNAVAILABLE"})
        )

        with pytest.raises(httpx.HTTPStatusError):
            await sf.search_products("OnePlus 12")


@pytest.mark.asyncio
async def test_empty_query_raises_before_sf_call(sf):
    with respx.mock:
        token_route = respx.post(TEST_TOKEN_URL).mock(
            return_value=httpx.Response(200, json=TOKEN_RESPONSE)
        )
        with pytest.raises(ValueError, match="empty"):
            await sf.search_products("   ")
    assert not token_route.called


@pytest.mark.asyncio
async def test_client_secret_not_in_logs(sf, caplog):
    with respx.mock:
        respx.post(TEST_TOKEN_URL).mock(return_value=httpx.Response(200, json=TOKEN_RESPONSE))
        respx.get(TEST_QUERY_URL).mock(return_value=httpx.Response(200, json=QUERY_RESPONSE))

        with caplog.at_level(logging.DEBUG):
            await sf.search_products("OnePlus 12")

    secret = sf._settings.sf_client_secret
    for record in caplog.records:
        assert secret not in record.getMessage(), "Secret leaked into logs!"
