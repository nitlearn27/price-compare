"""Spoke #1 — Salesforce catalog.

Queries the ``Grocery_Product__c`` catalog via SOQL and ranks/groups the rows.
Note: the catalog already spans multiple vendors (its rows carry a ``source__c``
of Amazon / Flipkart / Croma / …), so this one spoke can return several sources'
historical data — including the user's purchase history.
"""

from app.agents.base import SearchFilters, SourceAgent, SourceResult, apply_filters
from app.core.logging import get_logger
from app.services.product_search import rank_and_group
from app.services.salesforce import salesforce_client

logger = get_logger(__name__)


class SalesforceAgent(SourceAgent):
    name = "salesforce"

    async def search(
        self, query: str, limit: int, filters: SearchFilters | None = None
    ) -> SourceResult:
        records = await salesforce_client.search_products(query)
        listings = apply_filters(rank_and_group(records, query, limit), filters)
        for p in listings:
            p.origin = "catalog"
        logger.info("SalesforceAgent: %d listing(s) for %r", len(listings), query)
        return SourceResult(
            source="Salesforce catalog",
            listings=listings,
            status="ok" if listings else "empty",
        )
