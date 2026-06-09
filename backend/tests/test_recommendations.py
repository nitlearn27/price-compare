import httpx
import pytest
import respx

from app.services.recommendations import fetch_next_purchase

REC_URL = "https://insight-generation-production.up.railway.app/api/insights/next-purchase"

SAMPLE_RESPONSE = {
    "insight_message": "You're due for a refill on a daily perishable.",
    "recommendations": [
        {
            "product_name": "Aashirvaad Atta with Multigrains, 5kg",
            "product_url": "https://www.amazon.in/gp/product/B009BA7S8M",
            "price": 324.0,
            "reasoning": "Last purchased 9 days ago; now on sale.",
            "rating": "Not available",
            "highlights": ["On sale now", "Daily staple", "Bought 4x"],
        },
        {
            "product_name": "Nandini Homogenised Cow Milk",
            "product_url": "https://www.flipkart.com/nandini-milk",
            "price": 26.0,
            "reasoning": "Perishable likely due for a refill.",
            "rating": "Not available",
        },
    ],
}


@respx.mock
@pytest.mark.asyncio
async def test_fetch_next_purchase_parses_response():
    route = respx.post(REC_URL).mock(return_value=httpx.Response(200, json=SAMPLE_RESPONSE))

    result = await fetch_next_purchase("Give recommendations")

    assert route.called
    assert result.insight_message == SAMPLE_RESPONSE["insight_message"]
    assert len(result.recommendations) == 2
    assert result.recommendations[0].product_name.startswith("Aashirvaad")
    assert result.recommendations[0].highlights == ["On sale now", "Daily staple", "Bought 4x"]
    # Missing highlights default to an empty list rather than failing validation.
    assert result.recommendations[1].highlights == []
    assert result.recommendations[1].price == 26.0


@respx.mock
@pytest.mark.asyncio
async def test_fetch_next_purchase_sends_user_input():
    route = respx.post(REC_URL).mock(return_value=httpx.Response(200, json=SAMPLE_RESPONSE))

    await fetch_next_purchase("give me recommendation from only flipkart")

    sent = route.calls.last.request
    assert b"give me recommendation from only flipkart" in sent.content


@respx.mock
@pytest.mark.asyncio
async def test_fetch_next_purchase_raises_on_5xx():
    respx.post(REC_URL).mock(return_value=httpx.Response(500, text="boom"))

    with pytest.raises(httpx.HTTPStatusError):
        await fetch_next_purchase("Give recommendations")


@respx.mock
@pytest.mark.asyncio
async def test_fetch_next_purchase_raises_on_timeout():
    respx.post(REC_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))

    with pytest.raises(httpx.ConnectTimeout):
        await fetch_next_purchase("Give recommendations")


# ── Router ────────────────────────────────────────────────────────────────────


@respx.mock
def test_router_happy_path(client):
    respx.post(REC_URL).mock(return_value=httpx.Response(200, json=SAMPLE_RESPONSE))

    resp = client.post("/api/recommendations/next-purchase", json={"user_input": "x"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["insight_message"] == SAMPLE_RESPONSE["insight_message"]
    assert len(data["recommendations"]) == 2


@respx.mock
def test_router_blank_input_defaults(client):
    route = respx.post(REC_URL).mock(return_value=httpx.Response(200, json=SAMPLE_RESPONSE))

    resp = client.post("/api/recommendations/next-purchase", json={"user_input": "   "})

    assert resp.status_code == 200
    assert b"Give recommendations" in route.calls.last.request.content


@respx.mock
def test_router_missing_input_uses_schema_default(client):
    route = respx.post(REC_URL).mock(return_value=httpx.Response(200, json=SAMPLE_RESPONSE))

    resp = client.post("/api/recommendations/next-purchase", json={})

    assert resp.status_code == 200
    assert b"Give recommendations" in route.calls.last.request.content


@respx.mock
def test_router_upstream_failure_returns_502(client):
    respx.post(REC_URL).mock(return_value=httpx.Response(503, text="down"))

    resp = client.post("/api/recommendations/next-purchase", json={"user_input": "x"})

    assert resp.status_code == 502
    assert "unavailable" in resp.json()["detail"].lower()
