"""Shared types for the hub-spoke multi-agent search.

Each *spoke* agent has a single responsibility: query one source (Salesforce,
Flipkart, Amazon) and return normalized ``ProductListing`` objects. They are
deterministic async workers (no LLM), so they're fast and testable without any
model API calls. The *aggregator* (hub) fans out to all spokes in parallel and
merges their output.
"""

from dataclasses import dataclass, field
from typing import Literal

from app.models.schemas import ProductListing

SpokeStatus = Literal["ok", "empty", "error", "timeout", "not_implemented"]


@dataclass
class SourceResult:
    """One spoke's contribution to a search, plus its status for observability."""

    source: str  # display label, e.g. "Salesforce catalog", "Flipkart (live)"
    listings: list[ProductListing] = field(default_factory=list)
    status: SpokeStatus = "ok"
    detail: str | None = None


@dataclass
class SearchFilters:
    """Optional constraints applied to every spoke's results."""

    min_price: float | None = None
    max_price: float | None = None

    @property
    def active(self) -> bool:
        return self.min_price is not None or self.max_price is not None

    def matches(self, price: float | None) -> bool:
        if not self.active:
            return True
        if price is None:  # can't verify an unknown price against a bound — drop it
            return False
        if self.min_price is not None and price < self.min_price:
            return False
        if self.max_price is not None and price > self.max_price:
            return False
        return True


def apply_filters(
    listings: list[ProductListing], filters: SearchFilters | None
) -> list[ProductListing]:
    if filters is None or not filters.active:
        return listings
    return [p for p in listings if filters.matches(p.current_price)]


class SourceAgent:
    """Base class for a spoke agent. Subclasses implement ``search``."""

    name: str = "source"

    async def search(
        self, query: str, limit: int, filters: "SearchFilters | None" = None
    ) -> SourceResult:  # pragma: no cover
        raise NotImplementedError

    def enrich(
        self, listings: list[ProductListing], history: dict
    ) -> list[ProductListing]:
        """Hook for post-fetch enrichment (e.g. annotate with purchase history).
        Default is a no-op; spokes that benefit override it."""
        return listings
