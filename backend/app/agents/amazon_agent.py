"""Spoke #3 — Amazon live search (PLACEHOLDER).

Live Amazon pricing requires the authenticated/OTP login flow, which isn't built
yet. This spoke is intentionally a no-op that reports ``not_implemented`` so the
aggregator and UI already account for Amazon as a source. Implement the real
fetch here once the OTP login is wired (see app/services/otp.py).
"""

from app.agents.base import SearchFilters, SourceAgent, SourceResult


class AmazonAgent(SourceAgent):
    name = "amazon"
    covers_source = "Amazon"  # catalog source__c this live spoke can stand in for

    async def search(
        self, query: str, limit: int, filters: SearchFilters | None = None
    ) -> SourceResult:
        return SourceResult(
            source="Amazon (live)",
            listings=[],
            status="not_implemented",
            detail="Live Amazon search is not implemented yet (requires OTP login).",
        )
