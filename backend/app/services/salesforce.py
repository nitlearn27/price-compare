import asyncio
import time

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def escape_soql(value: str) -> str:
    """Escape special chars in a SOQL string literal (order matters)."""
    value = value.replace("\\", "\\\\")
    value = value.replace("'", "\\'")
    value = value.replace("%", "\\%")
    value = value.replace("_", "\\_")
    return value


# Filler words the LLM (or user) may leak into the search query — they almost
# never appear in actual product titles, so requiring them via AND-LIKE returns
# zero results. Stripped before building the SOQL.
_STOPWORDS = frozenset(
    {
        "a", "an", "the", "any", "some", "all",
        "give", "show", "find", "get", "tell", "list",
        "me", "us", "my", "i", "we",
        "price", "prices", "cost", "rate", "rates",
        "of", "for", "on", "in", "at", "with", "to",
        "best", "cheap", "cheapest", "good", "top", "popular",
        "please", "kindly",
        "is", "are", "available", "availability",
        "and", "or",
    }
)


def _filter_tokens(tokens: list[str]) -> list[str]:
    """Drop stopwords; keep meaningful product keywords."""
    return [t for t in tokens if t.lower() not in _STOPWORDS]


class SalesforceClient:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._access_token: str | None = None
        self._instance_url: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _fetch_token(self) -> None:
        s = self._settings
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                s.sf_token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": s.sf_client_id,
                    "client_secret": s.sf_client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )
        if resp.status_code != 200:
            logger.error("Salesforce token request failed: HTTP %s", resp.status_code)
            resp.raise_for_status()

        data = resp.json()
        self._access_token = data["access_token"]
        self._instance_url = data.get("instance_url") or s.sf_instance_url
        expires_in = int(data.get("expires_in", 7200))
        self._expires_at = time.monotonic() + expires_in - 300
        logger.debug("Salesforce token acquired, instance_url=%s", self._instance_url)

    async def _ensure_token(self) -> None:
        async with self._lock:
            if self._access_token is None or time.monotonic() >= self._expires_at:
                await self._fetch_token()

    async def _request(
        self,
        method: str,
        url: str,
        *,
        _retry: bool = True,
        **kwargs,
    ) -> dict:
        await self._ensure_token()
        headers = {"Authorization": f"Bearer {self._access_token}"}
        async with httpx.AsyncClient() as client:
            resp = await client.request(method, url, headers=headers, timeout=30.0, **kwargs)

        if resp.status_code == 401 and _retry:
            logger.warning("Salesforce 401 — refreshing token and retrying")
            async with self._lock:
                self._access_token = None
                self._expires_at = 0.0
            return await self._request(method, url, _retry=False, **kwargs)

        if resp.status_code >= 400:
            logger.error(f"Salesforce error: HTTP {resp.status_code} body={resp.text}")
            resp.raise_for_status()

        return resp.json()

    def _build_soql(self, where_clause: str, limit: int) -> str:
        return (
            "SELECT Id, Name, title__c, source__c, current_price__c, original_price__c, "
            "last_purchased_price__c, "
            "discount__c, rating__c, review_count__c, rank__c, product_url__c, "
            "image_url__c, availability__c, weight__c, last_ordered_date__c, "
            "number_of_times_purchased__c "
            "FROM Grocery_Product__c "
            f"WHERE {where_clause} AND source__c != null AND source__c != '' "
            "ORDER BY source__c ASC, rating__c DESC NULLS LAST, "
            "review_count__c DESC NULLS LAST "
            f"LIMIT {limit}"
        )

    async def search_products(self, query: str, limit: int | None = None) -> list[dict]:
        query = query.strip()
        if not query:
            raise ValueError("Search query must not be empty or whitespace.")

        s = self._settings
        limit = limit if limit is not None else s.sf_query_limit

        # Tokenise, drop stopwords, cap at 5 to keep SOQL length sane.
        raw_tokens = query.split()
        meaningful = _filter_tokens(raw_tokens)[:5]
        # If everything was stopwords (e.g. user typed only "the price of"),
        # fall back to a single substring search on the full input.
        tokens = meaningful or [query]

        escaped = [escape_soql(t) for t in tokens]
        and_clauses = " AND ".join(f"title__c LIKE '%{t}%'" for t in escaped)

        instance_url = self._instance_url or s.sf_instance_url
        url = f"{instance_url}/services/data/v{s.sf_api_version}/query"

        soql = self._build_soql(and_clauses, limit)
        logger.debug("SOQL query (AND): %s", soql)
        data = await self._request("GET", url, params={"q": soql})
        records = data.get("records", [])

        # Fallback: if the strict AND-of-tokens match returned nothing and we
        # have multiple tokens, retry with OR so any single-keyword hit still
        # surfaces results (Python ranking will prioritise full-query matches).
        if not records and len(escaped) > 1:
            or_clauses = " OR ".join(f"title__c LIKE '%{t}%'" for t in escaped)
            soql = self._build_soql(f"({or_clauses})", limit)
            logger.debug("SOQL query (OR fallback): %s", soql)
            data = await self._request("GET", url, params={"q": soql})
            records = data.get("records", [])

        logger.info("Salesforce returned %d records for query=%r", len(records), query)
        return records

    async def get_recent_products(self, days: int = 7, limit: int | None = None) -> list[dict]:
        from datetime import date, timedelta
        cutoff_date = (date.today() - timedelta(days=days)).isoformat()
        
        where_clause = f"last_ordered_date__c >= {cutoff_date}"
        
        s = self._settings
        limit = limit if limit is not None else s.sf_query_limit
        
        instance_url = self._instance_url or s.sf_instance_url
        url = f"{instance_url}/services/data/v{s.sf_api_version}/query"
        
        soql = self._build_soql(where_clause, limit)
        logger.info("SOQL query (recently ordered): %s", soql)
        data = await self._request("GET", url, params={"q": soql})
        return data.get("records", [])


# Module-level singleton — reused across requests to share the token cache.
salesforce_client = SalesforceClient()
