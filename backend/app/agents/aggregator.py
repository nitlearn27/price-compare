"""The aggregator (hub) of the hub-spoke multi-agent search.

Tiered fan-out:
  1. Query the catalog (Salesforce) first — it's fast and carries the user's
     purchase history.
  2. For each LIVE source (Flipkart, Amazon), hit its website **only if the
     catalog didn't already return a product from that source**. So if the
     catalog has at least one Flipkart and one Amazon item, no live calls happen;
     if it has Flipkart but no Amazon, only the live Amazon spoke runs.

The chosen live spokes run **in parallel** (``asyncio.gather``) under a per-spoke
timeout so one slow/failing source can't block the others. Results are merged
into a single de-duplicated list, with per-source status preserved for the caller
(and the conversational LLM).

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
        """Full tiered search: catalog first, then live for any uncovered source.
        A convenience composition of the two phases — the agent calls the phases
        directly to deliver catalog results now and append live results later."""
        catalog, uncovered = await self.search_catalog(query, limit, filters)
        if not uncovered:
            return catalog
        live = await self.search_live(query, limit, filters, source_names=uncovered)
        sources = catalog.sources + live.sources
        return AggregatedResult(listings=self._merge(sources), sources=sources)

    async def search_catalog(
        self,
        query: str,
        limit: int,
        filters: SearchFilters | None = None,
        force_live_sources: list[str] | None = None,
    ) -> tuple[AggregatedResult, list[str]]:
        """Phase 1 — the fast catalog (Salesforce) tier. Returns the catalog result
        plus the names of live spokes whose source the catalog did NOT cover."""
        s = get_settings()
        timeout = self._spoke_timeout
        if timeout is None:
            timeout = s.aggregator_spoke_timeout
        min_catalog = self._min_catalog_results
        if min_catalog is None:
            min_catalog = s.aggregator_min_catalog_results

        primary_results = await asyncio.gather(
            *(self._run_spoke(sp, query, limit, timeout, filters) for sp in self._primary)
        )

        # Count catalog listings per source (case-insensitive).
        catalog_by_source: dict[str, int] = {}
        for r in primary_results:
            for p in r.listings:
                key = (p.source or "").lower().strip()
                catalog_by_source[key] = catalog_by_source.get(key, 0) + 1

        # A live spoke is covered when catalog sources *start with* its
        # covers_source — the catalog stores variants like "Amazon Now" /
        # "Amazon Fresh" that the single live "Amazon" spoke stands in for.
        def covered_count(covers: str) -> int:
            if not covers:
                return 0
            return sum(
                n for src, n in catalog_by_source.items() if src.startswith(covers)
            )

        force_set = {src.lower() for src in force_live_sources} if force_live_sources else set()
        uncovered = []
        for sp in self._live:
            if sp.name.lower() in force_set:
                uncovered.append(sp.name)
            elif covered_count((sp.covers_source or "").lower().strip()) < min_catalog:
                uncovered.append(sp.name)

        logger.info(
            "Catalog coverage by source: %s — uncovered live sources: %s",
            catalog_by_source,
            uncovered,
        )
        merged = self._merge(list(primary_results))
        return AggregatedResult(listings=merged, sources=list(primary_results)), uncovered

    async def search_live(
        self,
        query: str,
        limit: int,
        filters: SearchFilters | None = None,
        source_names: list[str] | None = None,
    ) -> AggregatedResult:
        """Phase 2 — the slow live store tier. Runs the named live spokes (or all),
        enriches them with purchase history, and merges."""
        s = get_settings()
        timeout = self._spoke_timeout
        if timeout is None:
            timeout = s.aggregator_spoke_timeout
        enrich = self._enrich_history
        if enrich is None:
            enrich = s.aggregator_enrich_history

        spokes = self._live
        if source_names is not None:
            wanted = {n.lower() for n in source_names}
            spokes = [sp for sp in self._live if sp.name.lower() in wanted]
        if not spokes:
            return AggregatedResult(listings=[], sources=[])

        # Query Salesforce to find existing catalog titles so we can exclude duplicates
        exclude_titles = set()
        try:
            sf_records = await salesforce_client.search_products(query)
            for r in sf_records:
                title = r.get("Title__c") or r.get("Name")
                if title:
                    exclude_titles.add(title.lower().strip())
        except Exception:
            logger.warning(
                "Failed to query Salesforce catalog to build exclude list", exc_info=True
            )

        # Load the purchase-history map concurrently so enrichment adds no wait.
        history_task = (
            asyncio.create_task(self._load_history(s.aggregator_history_days))
            if enrich
            else None
        )
        live_results = await asyncio.gather(
            *(
                self._run_spoke(sp, query, limit, timeout, filters, exclude_titles=exclude_titles)
                for sp in spokes
            )
        )
        history = await history_task if history_task is not None else {}
        for spoke, result in zip(spokes, live_results):
            result.listings = spoke.enrich(result.listings, history)

        logger.info("Live sources queried: %s", [sp.name for sp in spokes])
        merged = self._merge(list(live_results))
        return AggregatedResult(listings=merged, sources=list(live_results))

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
        exclude_titles: set[str] | None = None,
    ) -> SourceResult:
        """Run one spoke with graceful degradation — a timeout or error becomes a
        status, never an exception that fails the whole search."""
        try:
            return await asyncio.wait_for(
                spoke.search(query, limit, filters, exclude_titles=exclude_titles),
                timeout,
            )
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
                # Fall back to id when a title is missing so distinct rows can't
                # silently collapse into one (e.g. an upstream field rename).
                title_key = p.title.lower().strip() or p.id.lower()
                key = (p.source.lower().strip(), title_key)
                if key in seen:
                    existing = merged[seen[key]]
                    if existing.times_purchased is None and p.times_purchased is not None:
                        merged[seen[key]] = p
                    continue
                seen[key] = len(merged)
                merged.append(p)
        return merged


aggregator_agent = AggregatorAgent()
