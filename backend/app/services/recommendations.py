import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import RecommendationResponse

logger = get_logger(__name__)


async def fetch_next_purchase(user_input: str) -> RecommendationResponse:
    """Call the external recommendation engine and parse its response.

    Exceptions (HTTP errors, timeouts, malformed payloads) are allowed to
    propagate; the router maps them to a 502, mirroring the products flow.
    """
    s = get_settings()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            s.recommendation_api_url,
            json={"user_input": user_input},
            headers={"Content-Type": "application/json"},
            timeout=60.0,
        )

    if resp.status_code >= 400:
        logger.error(
            "Recommendation engine error: HTTP %s — %s", resp.status_code, resp.text[:200]
        )
        resp.raise_for_status()

    data = resp.json()
    logger.info(
        "Recommendation engine returned %d items", len(data.get("recommendations", []))
    )
    return RecommendationResponse(**data)
