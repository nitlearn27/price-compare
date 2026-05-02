import re

from app.models.schemas import ProductListing


def _safe_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _safe_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def _ci_get(record: dict, key: str):
    """Case-insensitive lookup. Salesforce returns custom field names with
    whatever case is stored in metadata — defending against both `Title__c`
    and `title__c` keeps us decoupled from org-specific naming."""
    if key in record:
        return record[key]
    target = key.lower()
    for k, v in record.items():
        if k.lower() == target:
            return v
    return None


def _score(record: dict, query: str, tokens: list[str]) -> tuple[float, float, int]:
    title = (_ci_get(record, "Title__c") or "").lower()
    match_score = 10.0 if query.lower() in title else 0.0
    for token in tokens:
        if token and re.search(rf"\b{re.escape(token.lower())}\b", title):
            match_score += 1.0
    rating = _safe_float(_ci_get(record, "Rating__c")) or 0.0
    review_count = _safe_int(_ci_get(record, "Review_Count__c")) or 0
    return (match_score, rating, review_count)


def _normalize(record: dict) -> ProductListing:
    current_price = _safe_float(_ci_get(record, "Current_Price__c"))
    original_price = _safe_float(_ci_get(record, "Original_Price__c"))
    discount = _safe_int(_ci_get(record, "Discount__c"))

    if (
        discount is None
        and current_price is not None
        and original_price is not None
        and original_price > 0
        and original_price > current_price
    ):
        discount = round((1 - current_price / original_price) * 100)

    rating_value = _ci_get(record, "Rating__c")

    return ProductListing(
        id=_ci_get(record, "Id") or "",
        title=_ci_get(record, "Title__c") or _ci_get(record, "Name") or "",
        source=_ci_get(record, "Source__c") or "",
        current_price=current_price,
        original_price=original_price,
        discount=discount,
        rating=str(rating_value) if rating_value is not None else None,
        review_count=_safe_int(_ci_get(record, "Review_Count__c")),
        rank=_safe_int(_ci_get(record, "Rank__c")),
        product_url=_ci_get(record, "Product_URL__c"),
        image_url=_ci_get(record, "Image_URL__c"),
        availability=_ci_get(record, "Availability__c"),
    )


def rank_and_group(
    records: list[dict],
    query: str,
    per_source: int = 3,
) -> list[ProductListing]:
    tokens = [t for t in query.strip().split() if t]
    groups: dict[str, list[tuple]] = {}
    for record in records:
        source = _ci_get(record, "Source__c") or "Unknown"
        score_tuple = _score(record, query, tokens)
        groups.setdefault(source, []).append((score_tuple, record))

    result: list[ProductListing] = []
    for _source, items in groups.items():
        items.sort(key=lambda x: x[0], reverse=True)
        for _, record in items[:per_source]:
            result.append(_normalize(record))
    return result
