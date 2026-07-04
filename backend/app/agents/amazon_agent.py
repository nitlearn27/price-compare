"""Spoke #3 — Amazon live search.

This spoke fetches live listings from Amazon, ranks them by value, and enriches
them with the user's purchase history.
"""

from app.agents.base import (
    SearchFilters,
    SourceAgent,
    SourceResult,
    apply_filters,
)
from app.core.logging import get_logger
from app.models.schemas import ProductListing
from app.services.amazon_search import search_amazon

logger = get_logger(__name__)

# How many candidates to pull before ranking.
_CANDIDATE_POOL = 40

# Value-score weights (sum to 1.0). Tuned so quality and price dominate.
_W_RATING = 0.40
_W_PRICE = 0.35
_W_DISCOUNT = 0.15
_W_REVIEWS = 0.10


def _parse_rating(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _norm(value: float | None, lo: float | None, hi: float | None, invert: bool = False) -> float:
    if value is None or lo is None or hi is None or hi == lo:
        return 0.0
    n = (value - lo) / (hi - lo)
    return 1.0 - n if invert else n


def rank_by_value(
    listings: list[ProductListing], limit: int, query: str = ""
) -> list[ProductListing]:
    if len(listings) <= 1:
        return listings[:limit]

    prices = [p.current_price for p in listings if p.current_price is not None]
    ratings = [r for r in (_parse_rating(p.rating) for p in listings) if r is not None]
    discounts = [p.discount for p in listings if p.discount is not None]
    reviews = [p.review_count for p in listings if p.review_count is not None]

    p_lo, p_hi = (min(prices), max(prices)) if prices else (None, None)
    r_lo, r_hi = (min(ratings), max(ratings)) if ratings else (None, None)
    d_lo, d_hi = (min(discounts), max(discounts)) if discounts else (None, None)
    v_lo, v_hi = (min(reviews), max(reviews)) if reviews else (None, None)

    tokens = [t for t in query.lower().split() if len(t) >= 2]

    def relevance(p: ProductListing) -> int:
        title = (p.title or "").lower()
        return 1 if any(t in title for t in tokens) else 0

    def value(p: ProductListing) -> float:
        return (
            _W_RATING * _norm(_parse_rating(p.rating), r_lo, r_hi)
            + _W_PRICE * _norm(p.current_price, p_lo, p_hi, invert=True)
            + _W_DISCOUNT * _norm(p.discount, d_lo, d_hi)
            + _W_REVIEWS * _norm(p.review_count, v_lo, v_hi)
        )

    return sorted(listings, key=lambda p: (relevance(p), value(p)), reverse=True)[:limit]


def _match_history(title: str, history: dict) -> ProductListing | None:
    key = title.lower().strip()
    if not key:
        return None
    if key in history:
        return history[key]
    for hkey, listing in history.items():
        if key in hkey or hkey in key:
            return listing
    return None


class AmazonAgent(SourceAgent):
    name = "amazon"
    covers_source = "Amazon"  # catalog source__c this live spoke can stand in for

    async def search(
        self,
        query: str,
        limit: int,
        filters: SearchFilters | None = None,
        exclude_titles: set[str] | None = None,
    ) -> SourceResult:
        candidates = await search_amazon(query, _CANDIDATE_POOL)
        in_range = apply_filters(candidates, filters)
        if exclude_titles:
            in_range = [p for p in in_range if p.title.lower().strip() not in exclude_titles]
        best = rank_by_value(in_range, limit, query)
        for p in best:
            p.origin = "live"
        logger.info(
            "AmazonAgent: %d candidate(s) → %d in-range → top %d for %r",
            len(candidates),
            len(in_range),
            len(best),
            query,
        )
        return SourceResult(
            source="Amazon (live)",
            listings=best,
            status="ok" if best else "empty",
        )

    def enrich(
        self, listings: list[ProductListing], history: dict
    ) -> list[ProductListing]:
        if not history:
            return listings
        for p in listings:
            match = _match_history(p.title, history)
            if match and match.times_purchased:
                p.times_purchased = match.times_purchased
                p.last_ordered_date = match.last_ordered_date
                p.buy_suggestion = match.buy_suggestion
                p.suggestion_reason = match.suggestion_reason
        return listings
