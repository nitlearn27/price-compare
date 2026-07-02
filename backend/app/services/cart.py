import asyncio

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import CartCheckoutResponse, CartItemCheckout

logger = get_logger(__name__)

# The upstream cart service is asynchronous and single-flight: a POST kicks off
# an add-to-cart run (HTTP 202) and, while that run is active, further POSTs are
# rejected with HTTP 409 "a cart operation is already in progress". Runs finish
# within a few seconds, so we briefly retry a busy (409) response before giving up.
_BUSY_RETRY_ATTEMPTS = 3
_BUSY_RETRY_DELAY_S = 2.0


async def call_deepseek(prompt: str) -> str:
    s = get_settings()
    if not s.deepseek_api_key:
        logger.warning("DEEPSEEK_API_KEY not configured, falling back to simple match")
        return ""

    headers = {
        "Authorization": f"Bearer {s.deepseek_api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": s.deepseek_model,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful product matching assistant. You return only the matched product title, or 'NONE' if no product is a good match. No explanation, no markdown formatting."
            },
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0,
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(s.deepseek_base_url, json=payload, headers=headers, timeout=15.0)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
            else:
                logger.error("DeepSeek API error: HTTP %s", resp.status_code)
        except Exception:
            logger.exception("Failed to call DeepSeek API")
    return ""


async def extract_core_keyword(product_name: str) -> str:
    prompt = (
        f"You are a shopping assistant. Extract the single core product keyword/noun from this detailed product name.\n"
        f"For example:\n"
        f"- 'Fresh Brinjal Bharta (Bottle Shape)' -> 'brinjal'\n"
        f"- 'Nandini Homogenised Cow Milk' -> 'milk'\n"
        f"- 'Aashirvaad Superior MP Atta 5kg' -> 'atta'\n"
        f"- 'Fresh Onion 1kg' -> 'onion'\n"
        f"Product name: '{product_name}'\n"
        f"Reply ONLY with the extracted core product name in lowercase, and nothing else."
    )
    val = ""
    try:
        core_keyword = await call_deepseek(prompt)
        val = core_keyword.strip().lower()
        val = val.replace("'", "").replace('"', "").replace(".", "")
    except Exception as exc:
        logger.warning("Failed to extract core keyword using DeepSeek: %s", exc)

    if not val or val == "none":
        # Simple local fallback if deepseek returned empty or is unconfigured
        words = [w.lower() for w in product_name.split() if w.isalpha()]
        for word in words:
            if word in ["brinjal", "milk", "onion", "atta", "salt", "oil", "sugar", "bread", "butter"]:
                return word
        return words[0] if words else product_name
    return val


async def _resolve_cross(name: str, target_source: str) -> str:
    core = await extract_core_keyword(name)
    return await _resolve_name(core, target_source)


async def _resolve_name(original_name: str, target_source: str) -> str:
    try:
        from app.services.salesforce import salesforce_client
        records = await salesforce_client.search_products(original_name)
    except Exception as exc:
        logger.warning("Salesforce search failed during name resolution: %s", exc)
        return original_name

    # Filter records for target_source where it has been purchased before
    purchased_records = []
    for r in records:
        src = r.get("Source__c") or r.get("source__c")
        if not src or src.lower() != target_source.lower():
            continue

        times = r.get("Number_Of_Times_Purchased__c") or r.get("number_of_times_purchased__c")
        last_ordered = r.get("Last_Ordered_Date__c") or r.get("last_ordered_date__c")

        # Check if purchased before
        has_purchased = False
        try:
            if times is not None and int(times) > 0:
                has_purchased = True
        except (ValueError, TypeError):
            pass
        if last_ordered is not None:
            has_purchased = True

        if has_purchased:
            purchased_records.append(r)

    if not purchased_records:
        return original_name

    # Get unique titles
    titles = []
    for r in purchased_records:
        title = r.get("title__c") or r.get("Title__c") or r.get("Name")
        if title and title.strip():
            titles.append(title.strip())

    # Deduplicate titles keeping order
    unique_titles = []
    for t in titles:
        if t not in unique_titles:
            unique_titles.append(t)

    if not unique_titles:
        return original_name

    # If there is an exact case-insensitive match, use it immediately
    orig_lower = original_name.lower().strip()
    for t in unique_titles:
        if t.lower().strip() == orig_lower:
            return t

    # Use DeepSeek to match
    prompt = (
        f"We want to find a product similar to '{original_name}' from the user's previously ordered items. "
        f"Original requested name: '{original_name}'\n"
        f"Previously purchased products: {unique_titles}\n\n"
        f"Select the best matching product from the previously purchased list that represents the original requested name. "
        f"For example, if the requested name is 'onion', and previously purchased items has 'Fresh Onion', select 'Fresh Onion'. "
        f"If none of the previously purchased products is a good match for the requested product, return 'NONE'. "
        f"Respond only with the exact product title from the list, or 'NONE'."
    )

    matched_title = await call_deepseek(prompt)
    if matched_title and matched_title != "NONE":
        # Double check that matched_title is in unique_titles (case-insensitive)
        matched_lower = matched_title.lower().strip()
        for t in unique_titles:
            if t.lower().strip() == matched_lower:
                return t

    return original_name


async def _post_to_store(
    client: httpx.AsyncClient,
    url: str,
    products: list[str],
    store_label: str,
) -> CartCheckoutResponse:
    if not url:
        logger.error("%s cart URL is not configured", store_label)
        raise ValueError(f"{store_label} cart checkout is not configured.")

    resp = None
    for attempt in range(_BUSY_RETRY_ATTEMPTS + 1):
        resp = await client.post(
            url,
            json={"products": products},
            headers={"Content-Type": "application/json"},
            timeout=60.0,
        )
        if resp.status_code != 409:
            break
        if attempt < _BUSY_RETRY_ATTEMPTS:
            logger.info(
                "Cart busy (409) for %s; retrying in %.0fs (attempt %d/%d)",
                store_label,
                _BUSY_RETRY_DELAY_S,
                attempt + 1,
                _BUSY_RETRY_ATTEMPTS,
            )
            await asyncio.sleep(_BUSY_RETRY_DELAY_S)

    if resp.status_code == 409:
        # Still busy finishing another order — accept the submit so the cart
        # clears; the upstream will process orders as it frees up.
        logger.info(
            "Cart busy after %d retries for %s; accepting submit",
            _BUSY_RETRY_ATTEMPTS,
            store_label,
        )
        return CartCheckoutResponse(
            submitted=len(products),
            detail=f"Your {store_label} order is being processed.",
        )

    if resp.status_code >= 400:
        logger.error(
            "%s Cart API error: HTTP %s — %s",
            store_label,
            resp.status_code,
            resp.text[:200],
        )
        resp.raise_for_status()

    logger.info(
        "Submitted %d cart item(s) to %s (HTTP %s)",
        len(products),
        store_label,
        resp.status_code,
    )
    return CartCheckoutResponse(
        submitted=len(products),
        detail=f"Submitted {len(products)} item(s) to {store_label}.",
    )


async def submit_cart(
    products: list[str] | list[dict] | list[CartItemCheckout],
) -> CartCheckoutResponse:
    """Submit the whole cart to the external purchasing API, splitting items by
    source (Flipkart or Amazon) and dispatching them to their respective endpoints.
    Before submitting, we resolve each item's name by checking if a similar product
    has been ordered from that source in Salesforce. If so, we use the previously
    purchased product's title; otherwise, we use the original product name.
    """
    s = get_settings()

    resolved_flipkart_items = []
    resolved_amazon_items = []

    # Build tasks to resolve names concurrently
    resolution_tasks = []
    item_mappings = []

    for item in products:
        name = ""
        source = None
        if isinstance(item, str):
            name = item
        elif isinstance(item, dict):
            name = item.get("name", "")
            source = item.get("source")
        else:
            # Pydantic model
            name = getattr(item, "name", "")
            source = getattr(item, "source", None)

        name = name.strip()
        if not name:
            continue

        src_lower = source.lower() if source else ""
        if src_lower == "amazon":
            resolution_tasks.append(_resolve_name(name, "Amazon"))
            item_mappings.append(("Amazon", len(resolved_amazon_items)))
            resolved_amazon_items.append(None)

            resolution_tasks.append(_resolve_cross(name, "Flipkart"))
            item_mappings.append(("Flipkart", len(resolved_flipkart_items)))
            resolved_flipkart_items.append(None)
        elif src_lower == "flipkart":
            resolution_tasks.append(_resolve_name(name, "Flipkart"))
            item_mappings.append(("Flipkart", len(resolved_flipkart_items)))
            resolved_flipkart_items.append(None)

            resolution_tasks.append(_resolve_cross(name, "Amazon"))
            item_mappings.append(("Amazon", len(resolved_amazon_items)))
            resolved_amazon_items.append(None)
        else:
            # Source is None/empty, check both Flipkart and Amazon
            resolution_tasks.append(_resolve_name(name, "Flipkart"))
            item_mappings.append(("Flipkart", len(resolved_flipkart_items)))
            resolved_flipkart_items.append(None)

            resolution_tasks.append(_resolve_name(name, "Amazon"))
            item_mappings.append(("Amazon", len(resolved_amazon_items)))
            resolved_amazon_items.append(None)

    if resolution_tasks:
        resolved_names = await asyncio.gather(*resolution_tasks)
        for i, (source_type, index) in enumerate(item_mappings):
            resolved_name = resolved_names[i]
            if source_type == "Flipkart":
                resolved_flipkart_items[index] = resolved_name
            else:
                resolved_amazon_items[index] = resolved_name

    flipkart_items = [name for name in resolved_flipkart_items if name]
    amazon_items = [name for name in resolved_amazon_items if name]

    if not flipkart_items and not amazon_items:
        logger.info("Cart submit had no valid product names after cleaning")
        return CartCheckoutResponse(submitted=0, detail="No valid items to submit.")

    async with httpx.AsyncClient() as client:
        tasks = []
        if flipkart_items:
            tasks.append(
                _post_to_store(client, s.flipkart_add_cart_url, flipkart_items, "Flipkart")
            )
        if amazon_items:
            tasks.append(
                _post_to_store(client, s.amazon_add_cart_url, amazon_items, "Amazon")
            )

        results = await asyncio.gather(*tasks)

    # Combine results
    total_submitted = sum(r.submitted for r in results)
    details = [r.detail for r in results]
    return CartCheckoutResponse(
        submitted=total_submitted,
        detail=" ".join(details),
    )
