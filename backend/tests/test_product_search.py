from datetime import date

from app.services.product_search import (
    _derive_suggestion,
    _normalize,
    _parse_sf_date,
    _score,
    rank_and_group,
)


def make_record(**kwargs) -> dict:
    defaults = {
        "Id": "aaa",
        "Name": "P-001",
        "Title__c": "OnePlus 12 5G 256GB",
        "Source__c": "Amazon",
        "Current_Price__c": 60000.0,
        "Original_Price__c": 70000.0,
        "Last_Purchased_Price__c": None,
        "Discount__c": None,
        "Rating__c": "4.5",
        "Review_Count__c": 1000,
        "Rank__c": 3,
        "Product_URL__c": "https://amazon.in/dp/example",
        "Image_URL__c": None,
        "Availability__c": "In Stock",
        "Last_Ordered_Date__c": None,
        "Number_Of_Times_Purchased__c": None,
    }
    defaults.update(kwargs)
    return defaults


# ── _score ───────────────────────────────────────────────────────────────────


def test_score_orders_by_times_purchased_desc():
    a = make_record(Number_Of_Times_Purchased__c=5, Rank__c=1)
    b = make_record(Number_Of_Times_Purchased__c=2, Rank__c=1)
    assert _score(a) > _score(b)


def test_score_tiebreak_by_rank_when_purchases_equal():
    a = make_record(Number_Of_Times_Purchased__c=3, Rank__c=1)
    b = make_record(Number_Of_Times_Purchased__c=3, Rank__c=5)
    # lower rank (better vendor position) wins on tie
    assert _score(a) > _score(b)


def test_score_treats_null_times_as_zero():
    a = make_record(Number_Of_Times_Purchased__c=None, Rank__c=1)
    b = make_record(Number_Of_Times_Purchased__c=0, Rank__c=1)
    assert _score(a) == _score(b)


def test_score_null_rank_sorts_last_among_ties():
    a = make_record(Number_Of_Times_Purchased__c=0, Rank__c=5)
    b = make_record(Number_Of_Times_Purchased__c=0, Rank__c=None)
    # ranked records beat unranked ones when purchase counts tie
    assert _score(a) > _score(b)


def test_score_purchases_outrank_better_rank():
    most_bought = make_record(Number_Of_Times_Purchased__c=4, Rank__c=9)
    best_ranked = make_record(Number_Of_Times_Purchased__c=0, Rank__c=1)
    # times_purchased is primary — even a poor vendor rank wins over no history
    assert _score(most_bought) > _score(best_ranked)


# ── _normalize ────────────────────────────────────────────────────────────────


def test_normalize_computes_discount_when_null():
    record = make_record(Current_Price__c=60000, Original_Price__c=70000, Discount__c=None)
    listing = _normalize(record)
    # (1 - 60000/70000) * 100 = ~14.28 → round to 14
    assert listing.discount == 14


def test_normalize_keeps_explicit_discount():
    record = make_record(Current_Price__c=60000, Original_Price__c=70000, Discount__c=10)
    listing = _normalize(record)
    assert listing.discount == 10


def test_normalize_no_discount_when_prices_equal():
    record = make_record(Current_Price__c=70000, Original_Price__c=70000, Discount__c=None)
    listing = _normalize(record)
    assert listing.discount is None


def test_normalize_reads_weight_text():
    record = make_record(Weight__c="500 g")
    assert _normalize(record).weight == "500 g"


def test_normalize_formats_numeric_weight():
    # Whole numbers drop the trailing ".0"; fractional values are kept.
    assert _normalize(make_record(Weight__c=500.0)).weight == "500"
    assert _normalize(make_record(Weight__c=0.5)).weight == "0.5"


def test_normalize_weight_absent_is_none():
    assert _normalize(make_record()).weight is None  # no Weight__c in defaults


def test_normalize_handles_missing_optional_fields():
    record = make_record(
        Current_Price__c=None,
        Original_Price__c=None,
        Discount__c=None,
        Rating__c=None,
        Review_Count__c=None,
        Rank__c=None,
        Product_URL__c=None,
        Image_URL__c=None,
        Availability__c=None,
    )
    listing = _normalize(record)
    assert listing.current_price is None
    assert listing.discount is None
    assert listing.rating is None
    assert listing.review_count is None


def test_normalize_title_fallback_to_name():
    record = make_record(Title__c=None)
    listing = _normalize(record)
    assert listing.title == record["Name"]


def test_normalize_passes_through_availability():
    listing = _normalize(make_record(Availability__c="In Stock"))
    assert listing.availability == "In Stock"


def test_normalize_availability_none_when_absent():
    listing = _normalize(make_record(Availability__c=None))
    assert listing.availability is None


def test_normalize_parses_last_purchased_price():
    listing = _normalize(make_record(Last_Purchased_Price__c=59999))
    assert listing.last_purchased_price == 59999.0


def test_normalize_last_purchased_price_none_when_absent():
    listing = _normalize(make_record(Last_Purchased_Price__c=None))
    assert listing.last_purchased_price is None


def test_normalize_last_purchased_price_none_when_unparseable():
    listing = _normalize(make_record(Last_Purchased_Price__c="N/A"))
    assert listing.last_purchased_price is None


# ── rank_and_group ────────────────────────────────────────────────────────────


def test_groups_by_source(happy_path_records):
    results = rank_and_group(happy_path_records, "OnePlus 12", per_source=3)
    sources = [r.source for r in results]
    # Each source block is contiguous
    seen = []
    for s in sources:
        if not seen or seen[-1] != s:
            seen.append(s)
    assert len(seen) == len(set(sources))


def test_returns_at_most_per_source(happy_path_records):
    results = rank_and_group(happy_path_records, "OnePlus 12", per_source=2)
    from collections import Counter

    counts = Counter(r.source for r in results)
    assert all(v <= 2 for v in counts.values())


def test_returns_all_when_fewer_than_per_source(partial_records):
    # partial_records has 2 Reliance Digital records
    results = rank_and_group(partial_records, "OnePlus 12", per_source=3)
    rd = [r for r in results if r.source == "Reliance Digital"]
    assert len(rd) == 2  # only 2 available, not padded


def test_empty_records_returns_empty():
    results = rank_and_group([], "OnePlus 12")
    assert results == []


def test_best_match_ranks_first(happy_path_records):
    results = rank_and_group(happy_path_records, "OnePlus 12 5G 256GB", per_source=3)
    amazon = [r for r in results if r.source == "Amazon"]
    assert len(amazon) >= 1
    # Top Amazon result should contain "256GB"
    assert "256GB" in amazon[0].title or "256" in amazon[0].title


# ── _parse_sf_date ────────────────────────────────────────────────────────────


def test_parse_sf_date_iso():
    assert _parse_sf_date("2026-04-12") == date(2026, 4, 12)


def test_parse_sf_date_datetime_string_truncates():
    assert _parse_sf_date("2026-04-12T00:00:00.000Z") == date(2026, 4, 12)


def test_parse_sf_date_none_and_invalid():
    assert _parse_sf_date(None) is None
    assert _parse_sf_date("") is None
    assert _parse_sf_date("not-a-date") is None


# ── _derive_suggestion ────────────────────────────────────────────────────────

TODAY = date(2026, 5, 24)


def test_suggestion_new_when_count_none():
    label, reason = _derive_suggestion(None, None, TODAY)
    assert label == "new"
    assert reason == "Never ordered before"


def test_suggestion_new_when_count_zero():
    label, reason = _derive_suggestion(0, date(2026, 1, 1), TODAY)
    assert label == "new"
    assert reason == "Never ordered before"


def test_suggestion_frequent_when_count_three_or_more():
    label, reason = _derive_suggestion(4, date(2026, 5, 12), TODAY)
    assert label == "frequent"
    assert reason == "Bought 4x, last 12 days ago"


def test_suggestion_frequent_without_last_date():
    label, reason = _derive_suggestion(5, None, TODAY)
    assert label == "frequent"
    assert reason == "Bought 5x"


def test_suggestion_restock_when_last_order_old():
    last = date(2026, 4, 14)  # 40 days before TODAY
    label, reason = _derive_suggestion(1, last, TODAY)
    assert label == "restock"
    assert reason == "Bought 1x, last 40 days ago"


def test_suggestion_restock_at_seven_day_boundary():
    last = date(2026, 5, 17)  # exactly 7 days before TODAY
    label, _ = _derive_suggestion(1, last, TODAY)
    assert label == "restock"


def test_suggestion_recent_just_inside_threshold():
    last = date(2026, 5, 18)  # 6 days before TODAY — under the 7-day cutoff
    label, _ = _derive_suggestion(1, last, TODAY)
    assert label == "recent"


def test_suggestion_recent_when_last_order_close():
    last = date(2026, 5, 19)  # 5 days before TODAY
    label, reason = _derive_suggestion(1, last, TODAY)
    assert label == "recent"
    assert reason == "Bought 1x, last 5 days ago"


def test_suggestion_restock_when_count_but_no_date():
    label, reason = _derive_suggestion(2, None, TODAY)
    assert label == "restock"
    assert reason == "Bought 2x, last order date unknown"


def test_normalize_pins_today_and_yields_restock():
    record = make_record(
        Number_Of_Times_Purchased__c=1,
        Last_Ordered_Date__c="2026-04-01",
    )
    listing = _normalize(record, today=date(2026, 5, 24))
    assert listing.buy_suggestion == "restock"
    assert listing.suggestion_reason == "Bought 1x, last 53 days ago"
    assert listing.times_purchased == 1
    assert listing.last_ordered_date == "2026-04-01"


def test_normalize_yields_new_for_default_record():
    listing = _normalize(make_record(), today=date(2026, 5, 24))
    assert listing.buy_suggestion == "new"
    assert listing.times_purchased is None
    assert listing.last_ordered_date is None


def test_normalize_parses_complex_rating_dict_string():
    rating_str = "{'displayString': '4.3 out of 5 stars', 'fullStarCount': 4, 'hasHalfStar': True, 'shortDisplayString': '4.3', 'value': 4.3}"
    record = make_record(Rating__c=rating_str)
    listing = _normalize(record)
    assert listing.rating == "4.3"
