import httpx
import pytest
import respx

from app.services.cart import submit_cart

CART_URL = "https://purchase-history-production.up.railway.app/api/cart"

PRODUCTS = [
    {"name": "Amul Gold Milk", "source": "Flipkart"},
    {"name": "Aashirvaad Atta 5kg", "source": "Flipkart"},
]


@pytest.fixture(autouse=True)
def _setup_cart_settings():
    from app.core.config import get_settings
    settings = get_settings()
    settings.amazon_add_cart_url = settings.flipkart_add_cart_url
    yield


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Skip the real busy-retry backoff so tests stay fast."""

    async def _instant(_seconds):
        return None

    monkeypatch.setattr("app.services.cart.asyncio.sleep", _instant)


@pytest.fixture(autouse=True)
def _mock_deepseek_calls(monkeypatch):
    async def mock_extract(product_name):
        words = [w.lower() for w in product_name.split() if w.isalpha()]
        for word in words:
            staples = ["brinjal", "milk", "onion", "atta", "salt", "oil", "sugar", "bread"]
            if word in staples + ["butter"]:
                return word
        return words[0] if words else product_name

    monkeypatch.setattr("app.services.cart.extract_core_keyword", mock_extract)


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_posts_products_and_counts():
    route = respx.post(CART_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    result = await submit_cart(PRODUCTS)

    assert route.call_count == 2
    assert result.submitted == 4
    assert "2" in result.detail


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_sends_product_names():
    route = respx.post(CART_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    await submit_cart(PRODUCTS)

    contents = [call.request.content for call in route.calls]
    assert any(b"Amul Gold Milk" in c for c in contents)
    assert any(b"Aashirvaad Atta 5kg" in c for c in contents)
    assert any(b"milk" in c for c in contents)
    assert any(b"atta" in c for c in contents)


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_accepts_202_started():
    # The real upstream is async: a fresh POST returns 202 "started", not 200.
    route = respx.post(CART_URL).mock(
        return_value=httpx.Response(202, json={"status": "started"})
    )

    result = await submit_cart(PRODUCTS)

    assert route.call_count == 2
    assert result.submitted == 4


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_retries_on_409_then_succeeds():
    # First the upstream is busy (409), then a retry lands and is accepted (202).
    route = respx.post(CART_URL).mock(
        side_effect=[
            httpx.Response(409, json={"status": "running"}),
            httpx.Response(202, json={"status": "started"}),
            httpx.Response(202, json={"status": "started"}),
        ]
    )

    result = await submit_cart(PRODUCTS)

    assert route.call_count == 3
    assert result.submitted == 4


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_accepts_when_persistently_busy():
    # A perpetually busy upstream should not block the user: the submit is
    # accepted so the cart can clear, with a "processing" message.
    route = respx.post(CART_URL).mock(
        return_value=httpx.Response(409, json={"status": "running"})
    )

    result = await submit_cart(PRODUCTS)

    # initial attempt + _BUSY_RETRY_ATTEMPTS retries for two stores
    assert route.call_count == 8
    assert result.submitted == 4
    assert "processed" in result.detail.lower()


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_drops_blank_names():
    route = respx.post(CART_URL).mock(return_value=httpx.Response(202, json={"status": "started"}))

    result = await submit_cart([
        {"name": "  ", "source": "Flipkart"},
        {"name": "Lemon", "source": "Flipkart"},
        {"name": "", "source": "Flipkart"},
    ])

    contents = [call.request.content for call in route.calls]
    assert any(b"Lemon" in c for c in contents)
    assert any(b"lemon" in c for c in contents)
    assert result.submitted == 2


@pytest.mark.asyncio
async def test_submit_cart_no_call_when_all_blank():
    with respx.mock:
        route = respx.post(CART_URL).mock(return_value=httpx.Response(202))
        result = await submit_cart([
            {"name": "", "source": "Flipkart"},
            {"name": "   ", "source": "Flipkart"},
        ])
    assert not route.called
    assert result.submitted == 0


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_raises_on_5xx():
    respx.post(CART_URL).mock(return_value=httpx.Response(500, text="boom"))

    with pytest.raises(httpx.HTTPStatusError):
        await submit_cart(PRODUCTS)


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_raises_on_timeout():
    respx.post(CART_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))

    with pytest.raises(httpx.ConnectTimeout):
        await submit_cart(PRODUCTS)


# ── Router ────────────────────────────────────────────────────────────────────


@respx.mock
def test_router_checkout_happy_path(client):
    route = respx.post(CART_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    resp = client.post("/api/cart/checkout", json={"products": PRODUCTS})

    assert resp.status_code == 200
    data = resp.json()
    assert data["submitted"] == 4
    assert route.call_count == 2


def test_router_checkout_empty_products_rejected(client):
    resp = client.post("/api/cart/checkout", json={"products": []})
    assert resp.status_code == 422


def test_router_checkout_missing_products(client):
    resp = client.post("/api/cart/checkout", json={})
    assert resp.status_code == 422


@respx.mock
def test_router_checkout_upstream_failure_returns_502(client):
    respx.post(CART_URL).mock(return_value=httpx.Response(503, text="down"))

    resp = client.post("/api/cart/checkout", json={"products": PRODUCTS})

    assert resp.status_code == 502
    assert "unavailable" in resp.json()["detail"].lower()


@respx.mock
def test_router_checkout_persistent_busy_returns_200_accepted(client):
    route = respx.post(CART_URL).mock(return_value=httpx.Response(409, json={"status": "running"}))

    resp = client.post("/api/cart/checkout", json={"products": PRODUCTS})

    assert resp.status_code == 200
    assert "processed" in resp.json()["detail"].lower()
    assert route.call_count == 8


@pytest.mark.asyncio
async def test_submit_cart_resolves_names_from_salesforce(monkeypatch, respx_mock):
    from app.core.config import get_settings
    settings = get_settings()
    settings.amazon_add_cart_url = "https://amazon.test/api/cart"

    # Mock call_deepseek to return matched product title
    async def fake_deepseek(prompt):
        if "5 kg Onion" in prompt:
            return "5 kg Onion"
        if "Fresh Onion" in prompt:
            return "Fresh Onion"
        return "NONE"

    monkeypatch.setattr("app.services.cart.call_deepseek", fake_deepseek)

    # Mock Salesforce token endpoint
    respx_mock.post("https://test.salesforce.com/services/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "mock_token",
                "instance_url": "https://test.salesforce.com",
            },
        )
    )

    # Mock Salesforce query endpoint
    respx_mock.get(url__regex=r"https://test\.salesforce\.com/services/data/v.*/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "records": [
                    {
                        "Id": "1",
                        "title__c": "Fresh Onion",
                        "Source__c": "Flipkart",
                        "Number_Of_Times_Purchased__c": 5,
                        "Last_Ordered_Date__c": "2026-05-01",
                    },
                    {
                        "Id": "2",
                        "title__c": "5 kg Onion",
                        "Source__c": "Amazon",
                        "Number_Of_Times_Purchased__c": 2,
                        "Last_Ordered_Date__c": "2026-05-01",
                    },
                ]
            },
        )
    )

    fk_route = respx_mock.post(CART_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    amz_route = respx_mock.post("https://amazon.test/api/cart").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    result = await submit_cart([{"name": "onion", "source": None}])

    print("\n--- RESPX CALLS IN TEST ---")
    for call in respx_mock.calls:
        print(f"Request: {call.request.method} {call.request.url}")
        if call.response:
            print(f"Response: {call.response.status_code}")
        else:
            print("Response: None (not mocked / error)")
    print("---------------------------\n")

    assert fk_route.called
    assert amz_route.called

    fk_sent = fk_route.calls.last.request
    amz_sent = amz_route.calls.last.request

    import json

    assert json.loads(fk_sent.content)["products"] == ["Fresh Onion"]
    assert json.loads(amz_sent.content)["products"] == ["5 kg Onion"]
    assert result.submitted == 2


@pytest.mark.asyncio
async def test_submit_cart_resolves_cross_vendor(monkeypatch, respx_mock):
    from app.core.config import get_settings
    settings = get_settings()
    settings.amazon_add_cart_url = "https://amazon.test/api/cart"

    # Mock call_deepseek
    async def fake_deepseek(prompt):
        if "Extract the single core product keyword/noun" in prompt:
            if "Brinjal" in prompt:
                return "brinjal"
        if "Select the best matching product" in prompt:
            if "Original requested name: 'brinjal'" in prompt:
                return "Fresh Brinjal"
            if "Original requested name: 'Fresh Brinjal Bharta (Bottle Shape)'" in prompt:
                return "Bottle Shape Brinjal"
        return "NONE"

    monkeypatch.setattr("app.services.cart.call_deepseek", fake_deepseek)

    # Mock Salesforce token
    respx_mock.post("https://test.salesforce.com/services/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "mock_token",
                "instance_url": "https://test.salesforce.com",
            },
        )
    )

    # Mock Salesforce query
    respx_mock.get(url__regex=r"https://test\.salesforce\.com/services/data/v.*/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "records": [
                    {
                        "Id": "1",
                        "title__c": "Fresh Brinjal",
                        "Source__c": "Flipkart",
                        "Number_Of_Times_Purchased__c": 5,
                        "Last_Ordered_Date__c": "2026-05-01",
                    },
                    {
                        "Id": "2",
                        "title__c": "Bottle Shape Brinjal",
                        "Source__c": "Amazon",
                        "Number_Of_Times_Purchased__c": 2,
                        "Last_Ordered_Date__c": "2026-05-01",
                    },
                ]
            },
        )
    )

    fk_route = respx_mock.post(CART_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    amz_route = respx_mock.post("https://amazon.test/api/cart").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    result = await submit_cart([
        {"name": "Fresh Brinjal Bharta (Bottle Shape)", "source": "Amazon"}
    ])

    assert fk_route.called
    assert amz_route.called

    fk_sent = fk_route.calls.last.request
    amz_sent = amz_route.calls.last.request

    import json

    assert json.loads(fk_sent.content)["products"] == ["Fresh Brinjal"]
    assert json.loads(amz_sent.content)["products"] == ["Bottle Shape Brinjal"]
    assert result.submitted == 2




@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_partial_store_failure_reports_success_and_failure():
    """One store erroring must not sink the other's accepted submission."""
    from app.core.config import get_settings
    settings = get_settings()
    settings.amazon_add_cart_url = "https://amazon.test/api/cart"

    fk_route = respx.post(CART_URL).mock(
        return_value=httpx.Response(202, json={"status": "started"})
    )
    amz_route = respx.post("https://amazon.test/api/cart").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )

    result = await submit_cart(PRODUCTS)

    assert fk_route.called
    assert amz_route.called
    assert result.submitted == 2  # only the Flipkart half landed
    assert "Flipkart" in result.detail
    assert "Couldn't submit to Amazon" in result.detail


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_all_stores_failing_raises():
    from app.core.config import get_settings
    settings = get_settings()
    settings.amazon_add_cart_url = "https://amazon.test/api/cart"

    respx.post(CART_URL).mock(return_value=httpx.Response(500))
    respx.post("https://amazon.test/api/cart").mock(return_value=httpx.Response(500))

    with pytest.raises(httpx.HTTPStatusError):
        await submit_cart(PRODUCTS)


@respx.mock
@pytest.mark.asyncio
async def test_submit_cart_202_detail_mentions_delayed_cart():
    route = respx.post(CART_URL).mock(
        return_value=httpx.Response(202, json={"status": "started"})
    )

    result = await submit_cart(PRODUCTS)

    assert route.called
    assert "shortly" in result.detail
