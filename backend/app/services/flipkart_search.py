"""Live Flipkart keyword search — the fallback used when the Salesforce catalog
returns no matches.

Calls an external keyword-search microservice (configured via ``FLIPKART_SEARCH_URL``)
that returns Flipkart products as JSON, and normalizes each into a ``ProductListing``.
These are display-only: nothing is written back to Salesforce, so there is no order
history — every listing is surfaced as a "new" buy suggestion.
"""

import httpx

from app.core import config
from app.core.logging import get_logger
from app.models.schemas import ProductListing

logger = get_logger(__name__)

# Live Flipkart scraping is slow, so allow a generous read window while keeping
# connect/pool waits short. Broad terms (e.g. "lemon") can take well over 30s.
_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)


def _ci_get(item: dict, *keys: str):
    """Case-insensitive lookup across several candidate field names.

    The external service's exact field naming may drift, so we tolerate a few
    aliases (e.g. ``current_price`` vs ``price``) and either casing.
    """
    lowered = {k.lower(): v for k, v in item.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value is not None:
            return value
    return None


def _safe_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _safe_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _normalize_flipkart(item: dict, index: int) -> ProductListing:
    current_price = _safe_float(_ci_get(item, "current_price", "price"))
    original_price = _safe_float(_ci_get(item, "original_price", "mrp"))
    discount = _safe_int(_ci_get(item, "discount"))

    if (
        discount is None
        and current_price is not None
        and original_price is not None
        and original_price > 0
        and original_price > current_price
    ):
        discount = round((1 - current_price / original_price) * 100)

    rating_value = _ci_get(item, "rating")
    product_url = _ci_get(item, "product_url", "url")
    weight_value = _ci_get(item, "weight")

    return ProductListing(
        id=str(product_url or _ci_get(item, "id") or f"flipkart-{index}"),
        title=_ci_get(item, "title", "name") or "",
        source="Flipkart",
        current_price=current_price,
        original_price=original_price,
        last_purchased_price=None,
        discount=discount,
        rating=str(rating_value) if rating_value is not None else None,
        review_count=_safe_int(_ci_get(item, "review_count", "reviews")),
        rank=_safe_int(_ci_get(item, "rank")),
        product_url=product_url,
        image_url=_ci_get(item, "image_url", "image"),
        availability=_ci_get(item, "availability"),
        weight=str(weight_value) if weight_value is not None else None,
        last_ordered_date=None,
        times_purchased=None,
        buy_suggestion="new",
        suggestion_reason="Live Flipkart result",
    )


def _extract_items(data) -> list[dict]:
    """Accept either a bare JSON list or a wrapped object."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("results", "products", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return []


async def search_flipkart(query: str, limit: int) -> list[ProductListing]:
    """Fetch live Flipkart products for ``query`` (the model-extracted product name).

    Returns an empty list when the feature is unconfigured (blank URL). HTTP
    errors propagate so the router can map them to a 502.
    """
    url = config.get_settings().search_product_flipkart_url
    if not url:
        logger.info("Flipkart search skipped: SEARCH_PRODUCT_FLIPKART_URL not configured")
        return []

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params={"name": query}, timeout=_TIMEOUT)

    if resp.status_code >= 400:
        logger.error("Flipkart search error: HTTP %s — %s", resp.status_code, resp.text[:200])
        resp.raise_for_status()

    items = _extract_items(resp.json())[:limit]
    listings = [_normalize_flipkart(item, i) for i, item in enumerate(items)]
    logger.info("Flipkart search returned %d listing(s) for query=%r", len(listings), query)
    return listings
