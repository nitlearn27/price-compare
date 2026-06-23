import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger
from app.models.schemas import ProductListing
from app.services.gemini import identify_products_in_image
from app.services.product_search import rank_and_group
from app.services.salesforce import salesforce_client

router = APIRouter(tags=["identify"])
logger = get_logger(__name__)


class IdentifyRequest(BaseModel):
    image: str  # Base64 string (without Data URL prefix)
    mime_type: str = "image/jpeg"


class IdentifyResponse(BaseModel):
    reply: str
    results: list[ProductListing]


@router.post("/identify", response_model=IdentifyResponse)
async def identify_image(request: IdentifyRequest) -> IdentifyResponse:
    try:
        # 1. Extract products using Gemini API
        gemini_result = await identify_products_in_image(request.image, request.mime_type)
        items = gemini_result.get("items", [])
        summary = gemini_result.get("summary", "")

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
            )

        # Format items list for the chat bubble Markdown response
        items_list_md = "\n".join(
            f"- **{item['name']}** ({item.get('confidence', 'unknown')} confidence)"
            for item in items
        )
        reply_msg = (
            f"Here is a summary of what I found in your refrigerator/image:\n"
            f"> {summary}\n\n"
            f"**Identified items:**\n{items_list_md}\n\n"
            f"I have queried Salesforce for these products and updated "
            f"the comparison table on the right."
        )

        # 3. Query Salesforce for each product in parallel
        tasks = [salesforce_client.search_products(name) for name in product_names]
        all_records_lists = await asyncio.gather(*tasks, return_exceptions=True)

        combined_results = []
        for name, records in zip(product_names, all_records_lists):
            if isinstance(records, Exception):
                logger.error("Error searching Salesforce for %s: %s", name, records)
                continue
            # Rank and group per product, taking top 3 results per source
            product_results = rank_and_group(records, name, per_source=3)
            combined_results.extend(product_results)

        # 4. De-duplicate results by product ID
        seen_ids = set()
        unique_results = []
        for item in combined_results:
            if item.id not in seen_ids:
                seen_ids.add(item.id)
                unique_results.append(item)

        return IdentifyResponse(reply=reply_msg, results=unique_results)

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Image identification endpoint error")
        raise HTTPException(
            status_code=502,
            detail="The image identification service is currently unavailable. Please try again.",
        ) from exc
