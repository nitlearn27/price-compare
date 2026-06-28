import asyncio
import time

import httpx

from app.core import config
from app.core.logging import get_logger
from app.models.schemas import RecommendationResponse

logger = get_logger(__name__)

# In-memory TTL cache keyed by the (normalized) user input. The engine call is
# slow and its output is stable for a while, so we avoid re-calling it on every
# app open. Shielded by a lock so concurrent first-opens don't all hit upstream.
_cache: dict[str, tuple[float, RecommendationResponse]] = {}
_lock = asyncio.Lock()


async def fetch_next_purchase(
    user_input: str, refresh: bool = False
) -> RecommendationResponse:
    """Return next-purchase recommendations, served from cache when fresh.

    ``refresh=True`` bypasses the cache and re-populates it. Exceptions (HTTP
    errors, timeouts, malformed payloads) propagate; the router maps them to a 502.
    """
    s = config.get_settings()
    key = user_input.strip().lower()

    async with _lock:
        if not refresh:
            cached = _cache.get(key)
            if cached is not None:
                age = time.monotonic() - cached[0]
                if age < s.recommendation_cache_ttl_seconds:
                    logger.info("Recommendation cache hit for %r", user_input)
                    return cached[1]

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
        result = RecommendationResponse(**data)
        _cache[key] = (time.monotonic(), result)
        return result
