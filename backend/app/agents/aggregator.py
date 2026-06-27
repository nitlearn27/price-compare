"""The aggregator (hub) of the hub-spoke multi-agent search.

Fans out a single query to every source spoke **in parallel** (``asyncio.gather``),
applies a per-spoke timeout so one slow/failing source can't block the others,
and merges the results into a single de-duplicated list. Per-source status is
preserved so the caller (and the conversational LLM) can see which spokes
responded, were empty, timed out, or aren't implemented yet.

This module contains no LLM calls — it's deterministic and unit-testable without
any model API access.
"""

import asyncio
from dataclasses import dataclass, field

from app.agents.amazon_agent import AmazonAgent
from app.agents.base import SearchFilters, SourceAgent, SourceResult
from app.agents.flipkart_agent import FlipkartAgent
from app.agents.salesforce_agent import SalesforceAgent
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import ProductListing
from app.services.product_search import _normalize
from app.services.salesforce import salesforce_client

logger = get_logger(__name__)


@dataclass
class AggregatedResult:
    listings: list[ProductListing] = field(default_factory=list)
    sources: list[SourceResult] = field(default_factory=list)  # per-spoke status


class AggregatorAgent:
    def __init__(
        self,
        primary_spokes: list[SourceAgent] | None = None,
        live_spokes: list[SourceAgent] | None = None,
        spoke_timeout: float | None = None,
        enrich_history: bool | None = None,
        min_catalog_results: int | None = None,
    ) -> None:
        # Two tiers: the catalog (cheap/fast) is queried first; the live store
        # websites (slow) are only hit when the catalog comes up short. Injectable
        # for tests.
        self._primary = [SalesforceAgent()] if primary_spokes is None else primary_spokes
        self._live = (
            [FlipkartAgent(), AmazonAgent()] if live_spokes is None else live_spokes
        )
        self._spoke_timeout = spoke_timeout
        self._enrich_history = enrich_history
        self._min_catalog_results = min_catalog_results

    async def search(
        self, query: str, limit: int, filters: SearchFilters | None = None
    ) -> AggregatedResult:
        s = get_settings()
        timeout = self._spoke_timeout
        if timeout is None:
            timeout = s.aggregator_spoke_timeout
        enrich = self._enrich_history
        if enrich is None:
            enrich = s.aggregator_enrich_history
        min_catalog = self._min_catalog_results
        if min_catalog is None:
            min_catalog = s.aggregator_min_catalog_results

        # Tier 1 — catalog (Salesforce) first.
        primary_results = await asyncio.gather(
            *(self._run_spoke(sp, query, limit, timeout, filters) for sp in self._primary)
        )
        results = list(primary_results)
        catalog_count = sum(len(r.listings) for r in primary_results)

        if catalog_count >= min_catalog:
            # Catalog satisfied the search — skip the live websites entirely.
            logger.info(
                "Catalog satisfied (%d ≥ %d) — skipping live sources",
                catalog_count,
                min_catalog,
            )
        else:
            # Tier 2 — catalog thin/empty → hit the live store websites. Load the
            # purchase-history map concurrently so enrichment adds no extra wait.
            history_task = (
                asyncio.create_task(self._load_history(s.aggregator_history_days))
                if enrich
                else None
            )
            live_results = await asyncio.gather(
                *(self._run_spoke(sp, query, limit, timeout, filters) for sp in self._live)
            )
            history = await history_task if history_task is not None else {}
            for spoke, result in zip(self._live, live_results):
                result.listings = spoke.enrich(result.listings, history)
            results.extend(live_results)

        merged = self._merge(results)
        logger.info(
            "Aggregator: %d merged listing(s) from %s",
            len(merged),
            {r.source: r.status for r in results},
        )
        return AggregatedResult(listings=merged, sources=list(results))

    @staticmethod
    async def _load_history(days: int) -> dict:
        """Build a normalized-title → ProductListing map of recent purchases.
        Failures are non-fatal — enrichment is best-effort."""
        try:
            records = await salesforce_client.get_recent_products(days=days)
        except Exception:
            logger.warning("History load failed; skipping enrichment", exc_info=True)
            return {}
        history: dict[str, ProductListing] = {}
        for record in records:
            p = _normalize(record)
            key = p.title.lower().strip()
            if not key:
                continue
            prior = history.get(key)
            if prior is None or (p.times_purchased or 0) > (prior.times_purchased or 0):
                history[key] = p
        return history

    @staticmethod
    async def _run_spoke(
        spoke: SourceAgent,
        query: str,
        limit: int,
        timeout: float,
        filters: SearchFilters | None,
    ) -> SourceResult:
        """Run one spoke with graceful degradation — a timeout or error becomes a
        status, never an exception that fails the whole search."""
        try:
            return await asyncio.wait_for(spoke.search(query, limit, filters), timeout)
        except TimeoutError:
            logger.warning("Spoke %s timed out after %.1fs", spoke.name, timeout)
            return SourceResult(
                source=spoke.name,
                status="timeout",
                detail=f"{spoke.name} timed out after {timeout:.0f}s",
            )
        except Exception as exc:
            logger.exception("Spoke %s failed", spoke.name)
            return SourceResult(source=spoke.name, status="error", detail=str(exc))

    @staticmethod
    def _merge(results: list[SourceResult]) -> list[ProductListing]:
        """Concatenate all spoke listings, de-duplicating by (source, title).
        When the same product appears twice, keep the one carrying purchase
        history (``times_purchased``) since it's richer for ranking."""
        merged: list[ProductListing] = []
        seen: dict[tuple[str, str], int] = {}
        for result in results:
            for p in result.listings:
                key = (p.source.lower().strip(), p.title.lower().strip())
                if key in seen:
                    existing = merged[seen[key]]
                    if existing.times_purchased is None and p.times_purchased is not None:
                        merged[seen[key]] = p
                    continue
                seen[key] = len(merged)
                merged.append(p)
        return merged


aggregator_agent = AggregatorAgent()
