from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import ProductQuery, ProductSearchResponse
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
