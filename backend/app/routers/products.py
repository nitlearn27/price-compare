from fastapi import APIRouter, HTTPException

from app.agents.aggregator import aggregator_agent
from app.agents.base import SearchFilters
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import ProductQuery, ProductSearchResponse

router = APIRouter(tags=["products"])
logger = get_logger(__name__)


@router.post("/products/live", response_model=ProductSearchResponse)
async def search_products_live(query: ProductQuery) -> ProductSearchResponse:
    """Phase 2 of progressive search — fetch the slow live store results so the
    frontend can append them to the table after the instant catalog results."""
    if not query.query.strip():
        raise HTTPException(status_code=400, detail="Search query must not be empty.")

    s = get_settings()
    filters = SearchFilters(min_price=query.min_price, max_price=query.max_price)
    try:
        agg = await aggregator_agent.search_live(
            query.query, s.sf_results_per_source, filters, source_names=query.sources
        )
        return ProductSearchResponse(results=agg.listings)
    except Exception as exc:
        logger.exception("Live products endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The live product search is currently unavailable. Please try again.",
        ) from exc
