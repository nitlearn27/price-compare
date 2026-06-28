from fastapi import APIRouter, HTTPException

from app.agents.aggregator import aggregator_agent
from app.agents.base import SearchFilters
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import ProductQuery, ProductSearchResponse
from app.services.flipkart_search import search_flipkart
from app.services.product_search import rank_and_group
from app.services.salesforce import salesforce_client

router = APIRouter(tags=["products"])
logger = get_logger(__name__)


@router.post("/products/search", response_model=ProductSearchResponse)
async def search_products(query: ProductQuery) -> ProductSearchResponse:
    if not query.query.strip():
        raise HTTPException(status_code=400, detail="Search query must not be empty.")

    s = get_settings()
    try:
        records = await salesforce_client.search_products(query.query)
        results = rank_and_group(records, query.query, s.sf_results_per_source)
        return ProductSearchResponse(results=results)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Products search endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The product search service is currently unavailable. Please try again.",
        ) from exc


@router.post("/products/search/flipkart", response_model=ProductSearchResponse)
async def search_products_flipkart(query: ProductQuery) -> ProductSearchResponse:
    """Live Flipkart fallback — used by the frontend when the catalog search is empty."""
    if not query.query.strip():
        raise HTTPException(status_code=400, detail="Search query must not be empty.")

    s = get_settings()
    try:
        results = await search_flipkart(query.query, s.sf_results_per_source)
        return ProductSearchResponse(results=results)
    except Exception as exc:
        logger.exception("Flipkart search endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The Flipkart search service is currently unavailable. Please try again.",
        ) from exc


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
