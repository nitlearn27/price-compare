from unittest.mock import AsyncMock, patch
import pytest
from app.models.schemas import ProductListing


def _make_listing(**kwargs) -> dict:
    defaults = dict(
        id="xyz",
        title="Amul Milk",
        source="Flipkart",
        current_price=60,
        original_price=60,
        discount=0,
        rating="4.5",
        review_count=100,
        rank=1,
        product_url="https://flipkart.com/p/x",
        image_url=None,
        last_ordered_date=None,
        times_purchased=None,
        buy_suggestion=None,
        suggestion_reason=None,
    )
    defaults.update(kwargs)
    return defaults


def test_identify_success(client):
    gemini_mock = {
        "items": [
            {"name": "milk", "confidence": "high"},
            {"name": "eggs", "confidence": "medium"},
            {"name": "unlikely", "confidence": "low"}
        ],
        "summary": "Inside of refrigerator contains milk and eggs."
    }
    
    listings = [ProductListing(**_make_listing(id="milk-id", title="Amul Milk"))]

    with (
        patch(
            "app.routers.identify.identify_products_in_image",
            new_callable=AsyncMock,
            return_value=gemini_mock,
        ),
        patch(
            "app.routers.identify.salesforce_client.search_products",
            new_callable=AsyncMock,
            return_value=[{}],
        ),
        patch(
            "app.routers.identify.rank_and_group",
            return_value=listings,
        ),
    ):
        resp = client.post(
            "/api/identify",
            json={"image": "base64encodedbytes...", "mime_type": "image/png"},
        )
        
    assert resp.status_code == 200
    data = resp.json()
    assert "milk" in data["reply"].lower()
    assert "eggs" in data["reply"].lower()
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == "milk-id"


def test_identify_no_items_found(client):
    gemini_mock = {
        "items": [],
        "summary": "Empty refrigerator shelf."
    }

    with patch(
        "app.routers.identify.identify_products_in_image",
        new_callable=AsyncMock,
        return_value=gemini_mock,
    ):
        resp = client.post(
            "/api/identify",
            json={"image": "base64encodedbytes..."},
        )
        
    assert resp.status_code == 200
    data = resp.json()
    assert "couldn't identify" in data["reply"].lower()
    assert data["results"] == []


def test_identify_gemini_error_returns_502(client):
    with patch(
        "app.routers.identify.identify_products_in_image",
        new_callable=AsyncMock,
        side_effect=Exception("Gemini down"),
    ):
        resp = client.post(
            "/api/identify",
            json={"image": "base64encodedbytes..."},
        )
        
    assert resp.status_code == 502
