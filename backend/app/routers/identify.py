import asyncio
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger
from app.models.schemas import ProductListing
from app.services.cart_analysis import analyze_restock_candidates
from app.services.gemini import identify_products_in_image
from app.services.product_search import (
    _ci_get,
    _normalize,
    _parse_sf_date,
    _safe_float,
    _safe_int,
    rank_and_group,
)
from app.services.salesforce import salesforce_client

# Restock discovery & gating windows (tunable).
# Look this far back for the user's regular staples...
_RESTOCK_LOOKBACK_DAYS = 30
# ...but never re-order something bought within this many days — it's still fresh.
_RECENT_PURCHASE_SKIP_DAYS = 5

router = APIRouter(tags=["identify"])
logger = get_logger(__name__)


class IdentifyRequest(BaseModel):
    image: str  # Base64 string (without Data URL prefix)
    mime_type: str = "image/jpeg"


class MustHaveProduct(BaseModel):
    id: str
    title: str
    source: str
    reason: str | None = None


class IdentifyResponse(BaseModel):
    reply: str
    results: list[ProductListing]
    must_have: list[MustHaveProduct] = []


VEGETABLE_KEYWORDS = {
    "tomato", "potato", "onion", "garlic", "ginger", "lemon", "lime",
    "chili", "chilli", "carrot", "broccoli", "spinach", "lettuce", "cabbage",
    "cauliflower", "cucumber", "coriander", "mint", "capsicum", "pepper",
    "mushroom", "corn", "pea", "beans", "ladyfinger", "bhindi", "brinjal",
    "eggplant", "radish", "turnip", "beetroot", "pumpkin", "gourd", "zucchini",
    "okra", "vegetable"
}


def is_vegetable(title: str) -> bool:
    title_lower = title.lower()
    return any(keyword in title_lower for keyword in VEGETABLE_KEYWORDS)


@router.post("/identify", response_model=IdentifyResponse)
async def identify_image(request: IdentifyRequest) -> IdentifyResponse:
    try:
        # 1. Extract products using Gemini API (or OpenRouter fallback)
        gemini_result = await identify_products_in_image(request.image, request.mime_type)
        items = gemini_result.get("items", [])

        # 2. Filter products by confidence (high and medium are reliable)
        product_names = [
            item["name"]
            for item in items
            if item.get("confidence") in ("high", "medium")
        ]

        if not product_names:
            # Fallback to all items if no high/medium confidence items found
            product_names = [item["name"] for item in items]

        if not product_names:
            return IdentifyResponse(
                reply="Couldn't identify grocery items. Please try a clearer picture.",
                results=[],
                must_have=[],
            )

        # Format items list for the chat bubble Markdown response
        items_list_md = "\n".join(
            f"- **{item['name']}** ({item.get('confidence', 'unknown')})"
            for item in items
        )
        reply_msg = (
            f"**Identified items:**\n{items_list_md}\n\n"
            f"Updated the comparison table with these products."
        )

        # 3. Find STAPLES TO RESTOCK: items the user buys regularly that are NOT
        #    visible in the photo. Two gates stand before the cart:
        #      (a) deterministic freshness check — skip anything bought within the
        #          last few days (re-ordering it would just be waste), then
        #      (b) DeepSeek judgment — of what survives, only add items the model
        #          decides the user has likely run out of.
        today = date.today()
        recent_records = []
        try:
            recent_records = await salesforce_client.get_recent_products(
                days=_RESTOCK_LOOKBACK_DAYS
            )
        except Exception as e:
            logger.error("Failed to query recently ordered products: %s", e)

        # Keep one best-scored record per vegetable that isn't already in the photo.
        must_haves_grouped: dict[str, tuple] = {}
        for record in recent_records:
            title = _ci_get(record, "Title__c") or _ci_get(record, "Name") or ""
            if not is_vegetable(title):
                continue

            is_visible = False
            for p_name in product_names:
                p_norm = p_name.lower().strip()
                t_norm = title.lower().strip()
                if p_norm in t_norm or t_norm in p_norm:
                    is_visible = True
                    break
            if is_visible:
                continue

            veg_key = "vegetable"
            for kw in VEGETABLE_KEYWORDS:
                if kw in title.lower():
                    veg_key = kw
                    break

            times = _safe_int(_ci_get(record, "Number_Of_Times_Purchased__c")) or 0
            rating = _safe_float(_ci_get(record, "Rating__c")) or 0.0
            score = (times, rating)
            if veg_key not in must_haves_grouped or score > must_haves_grouped[veg_key][0]:
                must_haves_grouped[veg_key] = (score, record)

        # Gate (a): drop anything bought within the freshness window.
        candidates: list[dict] = []
        skipped_fresh: list[str] = []
        for score, record in must_haves_grouped.values():
            normalized = _normalize(record, today)
            last_ordered = _parse_sf_date(_ci_get(record, "Last_Ordered_Date__c"))
            days_since = (today - last_ordered).days if last_ordered else None
            if days_since is not None and days_since <= _RECENT_PURCHASE_SKIP_DAYS:
                skipped_fresh.append(f"{normalized.title} ({days_since}d ago)")
                continue
            candidates.append(
                {
                    "name": normalized.title,
                    "times": score[0],
                    "days_since": days_since if days_since is not None else "unknown",
                    "normalized": normalized,
                }
            )

        # Gate (b): DeepSeek decides which survivors genuinely need restocking.
        decisions = await analyze_restock_candidates(candidates)

        must_have_list: list[MustHaveProduct] = []
        added_lines: list[str] = []
        declined: list[str] = []
        for cand in candidates:
            normalized = cand["normalized"]
            dec = decisions.get(normalized.title.lower().strip())
            if dec and dec.add:
                must_have_list.append(
                    MustHaveProduct(
                        id=normalized.id,
                        title=normalized.title,
                        source=normalized.source,
                        reason=dec.reason or None,
                    )
                )
                added_lines.append(
                    f"**{normalized.title}**" + (f" — {dec.reason}" if dec.reason else "")
                )
            else:
                declined.append(normalized.title)

        if added_lines:
            reply_msg += (
                "\n\nAdded run-low staples to cart:\n"
                + "\n".join(f"- {line}" for line in added_lines)
            )
        if skipped_fresh:
            reply_msg += (
                "\n\nRecently bought (skipped): " + ", ".join(skipped_fresh)
            )
        if declined:
            reply_msg += (
                "\n\nStock sufficient (skipped): " + ", ".join(declined)
            )

        # 4. Query Salesforce for each visible product in parallel
        tasks = [salesforce_client.search_products(name) for name in product_names]
        all_records_lists = await asyncio.gather(*tasks, return_exceptions=True)

        combined_results = []
        for name, records in zip(product_names, all_records_lists):
            if isinstance(records, Exception):
                logger.error("Error searching Salesforce for %s: %s", name, records)
                continue
            product_results = rank_and_group(records, name, per_source=3)
            combined_results.extend(product_results)

        # 5. De-duplicate results by product ID
        seen_ids = set()
        unique_results = []
        for item in combined_results:
            if item.id not in seen_ids:
                seen_ids.add(item.id)
                unique_results.append(item)

        return IdentifyResponse(reply=reply_msg, results=unique_results, must_have=must_have_list)

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Image identification endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The image identification service is currently unavailable. Please try again.",
        ) from exc
