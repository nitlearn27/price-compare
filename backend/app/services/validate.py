"""Semantic relevance pass over search results (TS parity: worker/src/agent/validate.ts).

Runs after the fast, deterministically-filtered results are already emitted, and
drops rows that don't genuinely match the shopping intent. Fail-open: on any error,
unparseable reply, or empty keep-set it returns the input unchanged, so validation
never blanks or blocks the comparison table.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

from app.core.logging import get_logger
from app.models.schemas import ProductListing

if TYPE_CHECKING:
    from app.services.agent import ShoppingAgent

logger = get_logger(__name__)

_SYSTEM = (
    "You are a strict product-relevance filter for a shopping app. Given a shopping "
    "intent and a numbered list of product titles, decide which titles are the SAME "
    "product the user asked for — matching product TYPE, and BRAND when the intent "
    "names one. Exclude different product types even from the same brand (e.g. for "
    "'nandini butter', exclude 'Nandini Curd' and 'Nandini Paneer'). Respond with ONLY "
    "a compact JSON array of the indices to KEEP, e.g. [0,2,3]. No prose, no code fences."
)


def relevance_note(kept: list[ProductListing]) -> str:
    """A system note that pins the model's reply to the validated products, so its
    prose table matches the results grid. The tool output the model already saw
    still lists the dropped rows, and ``messages`` is append-only, so we steer the
    next turn rather than rewrite history."""
    lines = "\n".join(
        f"- {p.title}" + (f" ({p.source})" if p.source else "") for p in kept
    )
    return (
        "Relevance filter applied to the search results immediately above: only these "
        "products are a genuine match for the user's request. Build your comparison table "
        "and recommendation from ONLY these, and do not mention any other products from "
        "those results:\n" + lines
    )


def _parse_indices(raw: str, n: int) -> set[int] | None:
    """Extract the first JSON array of in-range integer indices from an LLM reply."""
    match = re.search(r"\[[\s\S]*?\]", raw)
    if not match:
        return None
    try:
        arr = json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(arr, list):
        return None
    keep: set[int] = set()
    for x in arr:
        try:
            i = int(x)
        except (TypeError, ValueError):
            continue
        if 0 <= i < n:
            keep.add(i)
    return keep


async def validate_relevance(
    agent: ShoppingAgent, query: str, listings: list[ProductListing]
) -> list[ProductListing]:
    if not query or len(listings) < 2:
        return listings

    lines = "\n".join(
        f"{i}: {p.title}" + (f" ({p.weight})" if p.weight else "")
        for i, p in enumerate(listings)
    )
    user = f'Shopping intent: "{query}"\n\nProducts (index: title):\n{lines}'
    convo = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]

    try:
        data = await agent._call_llm(convo, allow_tools=False)
        raw = (data["choices"][0]["message"].get("content") or "").strip()
    except Exception as exc:  # fail-open — the deterministic filter already ran
        logger.warning("relevance validation failed (%s) — keeping unfiltered results", exc)
        return listings

    keep = _parse_indices(raw, len(listings))
    if not keep:
        return listings
    filtered = [p for i, p in enumerate(listings) if i in keep]
    return filtered or listings
