import httpx
import pytest
import respx

from app.services.amazon_search import search_amazon

_URL = "https://amazon.test/search"


@pytest.mark.asyncio
async def test_blank_url_returns_empty(monkeypatch):
    from app.core import config

    settings = config.get_settings()
    monkeypatch.setattr(settings, "search_product_amazon_url", "")
    assert await search_amazon("milk", 3) == []


@pytest.mark.asyncio
async def test_happy_path_normalizes_and_forces_amazon():
    payload = [
        {
            "product_name": "Apple iPhone 15 (128GB)",
            "current_price": 65999,
            "original_price": 79900,
            "rating": "4.6",
            "review_count": 12000,
            "rank": 1,
            "product_url": "https://amazon.in/p/iphone-15",
            "image_url": "https://img/iphone.jpg",
            "availability": "In Stock",
        }
    ]
    with respx.mock:
        route = respx.get(_URL).mock(return_value=httpx.Response(200, json=payload))
        results = await search_amazon("iphone 15", 3)

    # the product name is sent as the `q` query param
    assert route.calls[0].request.url.params["q"] == "iphone 15"
    assert len(results) == 1
    item = results[0]
    assert item.source == "Amazon"
    assert item.buy_suggestion == "new"
    assert item.last_ordered_date is None
    assert item.times_purchased is None
    assert item.title == "Apple iPhone 15 (128GB)"
    assert item.product_url == "https://amazon.in/p/iphone-15"
    # discount computed from prices when not supplied
    assert item.discount == round((1 - 65999 / 79900) * 100)


@pytest.mark.asyncio
async def test_accepts_wrapped_object_and_aliases():
    payload = {
        "products": [
            {
                "product_name": "Tata Salt 1kg",
                "price": 28,
                "mrp": 30,
                "reviews": 450,
                "url": "https://amazon.in/p/tata-salt",
                "image": "https://img/salt.jpg",
            }
        ]
    }
    with respx.mock:
        respx.get(_URL).mock(return_value=httpx.Response(200, json=payload))
        results = await search_amazon("tata salt", 3)

    assert len(results) == 1
    item = results[0]
    assert item.title == "Tata Salt 1kg"
    assert item.current_price == 28
    assert item.original_price == 30
    assert item.review_count == 450
    assert item.product_url == "https://amazon.in/p/tata-salt"
    assert item.image_url == "https://img/salt.jpg"


@pytest.mark.asyncio
async def test_respects_limit():
    payload = [{"product_name": f"Item {i}", "price": i} for i in range(10)]
    with respx.mock:
        respx.get(_URL).mock(return_value=httpx.Response(200, json=payload))
        results = await search_amazon("item", 3)
    assert len(results) == 3


@pytest.mark.asyncio
async def test_http_error_propagates():
    with respx.mock:
        respx.get(_URL).mock(return_value=httpx.Response(500, text="boom"))
        with pytest.raises(httpx.HTTPStatusError):
            await search_amazon("milk", 3)
