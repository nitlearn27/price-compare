from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.models.schemas import RecommendationRequest, RecommendationResponse
from app.services.recommendations import fetch_next_purchase

router = APIRouter(tags=["recommendations"])
logger = get_logger(__name__)


@router.post("/recommendations/next-purchase", response_model=RecommendationResponse)
async def next_purchase(req: RecommendationRequest) -> RecommendationResponse:
    user_input = req.user_input.strip() or "Give recommendations"
    try:
        return await fetch_next_purchase(user_input)
    except Exception as exc:
        logger.exception("Recommendation endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The recommendation service is currently unavailable. Please try again.",
        ) from exc
