from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from pydantic import ValidationError

from app.models.schemas import ChatMessage, ProductListing, ProductQuery


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
