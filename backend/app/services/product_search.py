from datetime import date

from app.models.schemas import BuySuggestion, ProductListing


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


def _fmt_weight(value) -> str | None:
    """Weight__c may be numeric (e.g. 0.5) or text (e.g. "500 g"). Render it as a
    clean string for display, dropping a trailing ".0" on whole numbers."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        f = float(value)
        return str(int(f)) if f.is_integer() else str(f)
    text = str(value).strip()
    return text or None


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


def _parse_sf_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


_RESTOCK_THRESHOLD_DAYS = 7
_FREQUENT_THRESHOLD = 3
_MISSING_RANK_SCORE = -(10**9)


def _derive_suggestion(
    times: int | None,
    last_ordered: date | None,
    today: date,
) -> tuple[BuySuggestion | None, str | None]:
    if times is None or times <= 0:
        return "new", "Never ordered before"

    if times >= _FREQUENT_THRESHOLD:
        if last_ordered is not None:
            days = (today - last_ordered).days
            return "frequent", f"Bought {times}x, last {days} days ago"
        return "frequent", f"Bought {times}x"

    if last_ordered is None:
        return "restock", f"Bought {times}x, last order date unknown"

    days = (today - last_ordered).days
    if days >= _RESTOCK_THRESHOLD_DAYS:
        return "restock", f"Bought {times}x, last {days} days ago"
    return "recent", f"Bought {times}x, last {days} days ago"


def _score(record: dict) -> tuple[int, int]:
    """Determines order within a source group. The first item per group is shown
    as 'Top match' in the UI.

    Primary: number of times the user has purchased this product (desc).
    Tie-break: vendor rank__c (asc — #1 wins over #7). Records with no rank
    sort last among ties; records with no purchase history all tie at 0.
    """
    times = _safe_int(_ci_get(record, "Number_Of_Times_Purchased__c")) or 0
    rank_value = _safe_int(_ci_get(record, "Rank__c"))
    rank_score = -rank_value if rank_value is not None else _MISSING_RANK_SCORE
    return (times, rank_score)


def _normalize(record: dict, today: date | None = None) -> ProductListing:
    current_price = _safe_float(_ci_get(record, "Current_Price__c"))
    original_price = _safe_float(_ci_get(record, "Original_Price__c"))
    last_purchased_price = _safe_float(_ci_get(record, "Last_Purchased_Price__c"))
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

    times_purchased = _safe_int(_ci_get(record, "Number_Of_Times_Purchased__c"))
    last_ordered_raw = _ci_get(record, "Last_Ordered_Date__c")
    last_ordered_date = _parse_sf_date(last_ordered_raw)
    buy_suggestion, suggestion_reason = _derive_suggestion(
        times_purchased,
        last_ordered_date,
        today or date.today(),
    )

    return ProductListing(
        id=_ci_get(record, "Id") or "",
        title=_ci_get(record, "Title__c") or _ci_get(record, "Name") or "",
        source=_ci_get(record, "Source__c") or "",
        current_price=current_price,
        original_price=original_price,
        last_purchased_price=last_purchased_price,
        discount=discount,
        rating=str(rating_value) if rating_value is not None else None,
        review_count=_safe_int(_ci_get(record, "Review_Count__c")),
        rank=_safe_int(_ci_get(record, "Rank__c")),
        product_url=_ci_get(record, "Product_URL__c"),
        image_url=_ci_get(record, "Image_URL__c"),
        availability=_ci_get(record, "Availability__c"),
        weight=_fmt_weight(_ci_get(record, "Weight__c")),
        last_ordered_date=str(last_ordered_raw)[:10] if last_ordered_raw else None,
        times_purchased=times_purchased,
        buy_suggestion=buy_suggestion,
        suggestion_reason=suggestion_reason,
    )


def rank_and_group(
    records: list[dict],
    query: str,
    per_source: int = 3,
) -> list[ProductListing]:
    from app.services.salesforce import _filter_tokens
    query_tokens = _filter_tokens(query.split()) if query else []
    if not query_tokens:
        query_tokens = query.lower().split() if query else []
    query_tokens = [t.lower() for t in query_tokens]

    def get_relevance(record: dict) -> int:
        title = _ci_get(record, "Title__c") or _ci_get(record, "Name") or ""
        title_lower = title.lower()
        return sum(1 for t in query_tokens if t in title_lower)

    groups: dict[str, list[tuple]] = {}
    has_any_match = any(get_relevance(r) > 0 for r in records) if query_tokens else False

    for record in records:
        source = _ci_get(record, "Source__c") or "Unknown"
        relevance = get_relevance(record)
        # Discard completely irrelevant results that matched a loose OR query
        # only if we found at least one record that actually matches the keywords
        if has_any_match and relevance == 0:
            continue
        groups.setdefault(source, []).append(((relevance, _score(record)), record))

    result: list[ProductListing] = []
    for _source, items in groups.items():
        # Sort by relevance desc, then times desc, then rank_score desc (asc rank)
        items.sort(key=lambda x: (x[0][0], x[0][1][0], x[0][1][1]), reverse=True)
        for _, record in items[:per_source]:
            result.append(_normalize(record))
    return result
