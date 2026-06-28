from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from pydantic import ValidationError

from app.models.schemas import ChatMessage, ProductListing, ProductQuery

# ── /api/chat ─────────────────────────────────────────────────────────────────


def test_chat_success_no_tool_call(client):
    with patch(
        "app.routers.chat.openrouter_client.chat",
        new_callable=AsyncMock,
        return_value=("What's your budget?", None),
    ):
        resp = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}]},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reply"] == "What's your budget?"
    assert data["product_query"] is None


def test_chat_success_with_tool_call(client):
    pq = ProductQuery(query="OnePlus 12")
    with patch(
        "app.routers.chat.openrouter_client.chat",
        new_callable=AsyncMock,
        return_value=("Searching for OnePlus 12…", pq),
    ):
        resp = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Find OnePlus 12"}]},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["product_query"]["query"] == "OnePlus 12"


def test_chat_validation_error_empty_messages(client):
    resp = client.post("/api/chat", json={"messages": []})
    assert resp.status_code == 422


def test_chat_missing_body(client):
    resp = client.post("/api/chat", json={})
    assert resp.status_code == 422


def test_chat_upstream_error_returns_502(client):
    with patch(
        "app.routers.chat.openrouter_client.chat",
        new_callable=AsyncMock,
        side_effect=httpx.HTTPStatusError("err", request=None, response=None),
    ):
        resp = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}]},
        )
    assert resp.status_code == 502


# ── /api/products/search ──────────────────────────────────────────────────────


def _make_listing(**kwargs) -> dict:
    defaults = dict(
        id="aaa",
        title="OnePlus 12",
        source="Amazon",
        current_price=62000,
        original_price=70000,
        discount=11,
        rating="4.5",
        review_count=5000,
        rank=1,
        product_url="https://amazon.in/dp/x",
        image_url=None,
        last_ordered_date=None,
        times_purchased=None,
        buy_suggestion=None,
        suggestion_reason=None,
    )
    defaults.update(kwargs)
    return defaults


def test_products_search_success(client):
    listings = [ProductListing(**_make_listing())]
    with (
        patch(
            "app.routers.products.salesforce_client.search_products",
            new_callable=AsyncMock,
            return_value=[{}],
        ),
        patch(
            "app.routers.products.rank_and_group",
            return_value=listings,
        ),
    ):
        resp = client.post(
            "/api/products/search",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["title"] == "OnePlus 12"


def test_products_search_empty_query_rejected(client):
    resp = client.post("/api/products/search", json={"query": "   "})
    assert resp.status_code in (400, 422)


def test_products_search_missing_query(client):
    resp = client.post("/api/products/search", json={})
    assert resp.status_code == 422


def test_products_search_upstream_error_returns_502(client):
    with patch(
        "app.routers.products.salesforce_client.search_products",
        new_callable=AsyncMock,
        side_effect=Exception("SF down"),
    ):
        resp = client.post(
            "/api/products/search",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 502


def test_products_search_returns_empty_list(client):
    with (
        patch(
            "app.routers.products.salesforce_client.search_products",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "app.routers.products.rank_and_group",
            return_value=[],
        ),
    ):
        resp = client.post(
            "/api/products/search",
            json={"query": "nonexistent product xyz"},
        )
    assert resp.status_code == 200
    assert resp.json()["results"] == []


# ── /api/products/search/flipkart ─────────────────────────────────────────────


def test_flipkart_search_success(client):
    listings = [ProductListing(**_make_listing(source="Flipkart", buy_suggestion="new"))]
    with patch(
        "app.routers.products.search_flipkart",
        new_callable=AsyncMock,
        return_value=listings,
    ):
        resp = client.post(
            "/api/products/search/flipkart",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["source"] == "Flipkart"


def test_flipkart_search_empty_query_rejected(client):
    resp = client.post("/api/products/search/flipkart", json={"query": "   "})
    assert resp.status_code in (400, 422)


def test_flipkart_search_upstream_error_returns_502(client):
    with patch(
        "app.routers.products.search_flipkart",
        new_callable=AsyncMock,
        side_effect=Exception("Flipkart down"),
    ):
        resp = client.post(
            "/api/products/search/flipkart",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 502


# ── /api/products/search/amazon ──────────────────────────────────────────────


def test_amazon_search_success(client):
    listings = [ProductListing(**_make_listing(source="Amazon", buy_suggestion="new"))]
    with patch(
        "app.routers.products.search_amazon",
        new_callable=AsyncMock,
        return_value=listings,
    ):
        resp = client.post(
            "/api/products/search/amazon",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["source"] == "Amazon"


def test_amazon_search_empty_query_rejected(client):
    resp = client.post("/api/products/search/amazon", json={"query": "   "})
    assert resp.status_code in (400, 422)


def test_amazon_search_upstream_error_returns_502(client):
    with patch(
        "app.routers.products.search_amazon",
        new_callable=AsyncMock,
        side_effect=Exception("Amazon down"),
    ):
        resp = client.post(
            "/api/products/search/amazon",
            json={"query": "OnePlus 12"},
        )
    assert resp.status_code == 502


# ── /api/products/live (progressive phase 2) ──────────────────────────────────


def test_products_live_success(client):
    from app.agents.aggregator import AggregatedResult

    listings = [
        ProductListing(**_make_listing(source="Flipkart", origin="live", buy_suggestion="new"))
    ]
    with patch(
        "app.routers.products.aggregator_agent.search_live",
        new_callable=AsyncMock,
        return_value=AggregatedResult(listings=listings, sources=[]),
    ):
        resp = client.post(
            "/api/products/live",
            json={"query": "carrot", "sources": ["flipkart"]},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["origin"] == "live"


def test_products_live_empty_query_rejected(client):
    resp = client.post("/api/products/live", json={"query": "   "})
    assert resp.status_code in (400, 422)


# ── Schema roundtrip ──────────────────────────────────────────────────────────


def test_chat_message_roundtrip():
    m = ChatMessage(role="user", content="hello")
    assert ChatMessage.model_validate(m.model_dump()).content == "hello"


def test_chat_message_invalid_role():
    with pytest.raises(ValidationError):
        ChatMessage(role="admin", content="hi")


def test_product_query_roundtrip():
    pq = ProductQuery(query="iPhone 15", max_price=100000)
    pq2 = ProductQuery.model_validate(pq.model_dump())
    assert pq2.max_price == 100000


def test_product_query_empty_string_invalid():
    with pytest.raises(ValidationError):
        ProductQuery(query="")


# ── /api/products/refresh ─────────────────────────────────────────────────────


@respx.mock
def test_refresh_amazon_success(client):
    route = respx.post("https://refresh.test/amazon").mock(
        return_value=httpx.Response(202, json={"ok": True})
    )
    resp = client.post("/api/products/refresh", json={"source": "amazon"})

    assert resp.status_code == 200
    assert "Amazon" in resp.json()["detail"]
    # The refresh service posts the configured order count.
    assert route.called
    assert b'"orders"' in route.calls.last.request.content


@respx.mock
def test_refresh_flipkart_success(client):
    route = respx.post("https://refresh.test/flipkart").mock(
        return_value=httpx.Response(202, json={"ok": True})
    )
    resp = client.post("/api/products/refresh", json={"source": "flipkart"})

    assert resp.status_code == 200
    assert route.called


def test_refresh_invalid_source_rejected(client):
    resp = client.post("/api/products/refresh", json={"source": "ebay"})
    assert resp.status_code == 422


@respx.mock
def test_refresh_upstream_error_returns_502(client):
    respx.post("https://refresh.test/amazon").mock(return_value=httpx.Response(500, text="boom"))
    resp = client.post("/api/products/refresh", json={"source": "amazon"})
    assert resp.status_code == 502


# ── /api/otp ──────────────────────────────────────────────────────────────────


@respx.mock
def test_submit_otp_success(client):
    route = respx.post("https://otp.test/api/otp").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    resp = client.post("/api/otp", json={"otp": "600939"})

    assert resp.status_code == 200
    assert route.called
    # The entered code is forwarded verbatim in the body.
    assert b"600939" in route.calls.last.request.content


def test_submit_otp_empty_rejected(client):
    resp = client.post("/api/otp", json={"otp": ""})
    assert resp.status_code == 422


@respx.mock
def test_submit_otp_upstream_error_returns_502(client):
    respx.post("https://otp.test/api/otp").mock(return_value=httpx.Response(500, text="boom"))
    resp = client.post("/api/otp", json={"otp": "600939"})
    assert resp.status_code == 502


# ── Integration: end-to-end with both services mocked ────────────────────────


def test_integration_full_flow(client):
    """Full flow: chat → tool call → products search → grouped results."""
    pq = ProductQuery(query="OnePlus 12")
    listing = ProductListing(**_make_listing())

    with (
        patch(
            "app.routers.chat.openrouter_client.chat",
            new_callable=AsyncMock,
            return_value=("Searching for OnePlus 12…", pq),
        ),
        patch(
            "app.routers.products.salesforce_client.search_products",
            new_callable=AsyncMock,
            return_value=[{}],
        ),
        patch(
            "app.routers.products.rank_and_group",
            return_value=[listing],
        ),
    ):
        chat_resp = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "find me a OnePlus 12"}]},
        )
        assert chat_resp.status_code == 200
        chat_data = chat_resp.json()
        assert chat_data["product_query"] is not None

        search_resp = client.post(
            "/api/products/search",
            json=chat_data["product_query"],
        )
        assert search_resp.status_code == 200
        results = search_resp.json()["results"]
        assert len(results) <= 3
        assert results[0]["source"] == "Amazon"
