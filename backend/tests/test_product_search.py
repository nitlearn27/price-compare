from app.services.product_search import _normalize, _score, rank_and_group


def make_record(**kwargs) -> dict:
    defaults = {
        "Id": "aaa",
        "Name": "P-001",
        "Title__c": "OnePlus 12 5G 256GB",
        "Source__c": "Amazon",
        "Current_Price__c": 60000.0,
        "Original_Price__c": 70000.0,
        "Discount__c": None,
        "Rating__c": "4.5",
        "Review_Count__c": 1000,
        "Rank__c": 3,
        "Product_URL__c": "https://amazon.in/dp/example",
        "Image_URL__c": None,
        "Availability__c": "In Stock",
    }
    defaults.update(kwargs)
    return defaults


# ── _score ───────────────────────────────────────────────────────────────────


def test_score_full_query_match():
    record = make_record(Title__c="OnePlus 12 5G")
    score, _, _ = _score(record, "OnePlus 12", ["OnePlus", "12"])
    assert score >= 10  # full-query match


def test_score_token_match_only():
    record = make_record(Title__c="OnePlus Nord CE 5G")
    score, _, _ = _score(record, "OnePlus 12", ["OnePlus", "12"])
    assert score == 1  # only "OnePlus" token matches, "12" does not


def test_score_no_match():
    record = make_record(Title__c="Samsung Galaxy S24")
    score, _, _ = _score(record, "OnePlus 12", ["OnePlus", "12"])
    assert score == 0


def test_score_full_match_outranks_token_match():
    full_match = make_record(Title__c="OnePlus 12 phone", Rating__c="3.0", Review_Count__c=10)
    token_match = make_record(Title__c="OnePlus Nord 12 5G", Rating__c="4.9", Review_Count__c=99999)
    s_full = _score(full_match, "OnePlus 12", ["OnePlus", "12"])
    s_token = _score(token_match, "OnePlus 12", ["OnePlus", "12"])
    assert s_full > s_token


def test_score_tiebreak_by_rating():
    r1 = make_record(Title__c="OnePlus 12", Rating__c="4.8", Review_Count__c=100)
    r2 = make_record(Title__c="OnePlus 12", Rating__c="4.2", Review_Count__c=100)
    assert _score(r1, "OnePlus 12", ["OnePlus", "12"]) > _score(r2, "OnePlus 12", ["OnePlus", "12"])


def test_score_tiebreak_by_review_count():
    r1 = make_record(Title__c="OnePlus 12", Rating__c="4.5", Review_Count__c=5000)
    r2 = make_record(Title__c="OnePlus 12", Rating__c="4.5", Review_Count__c=100)
    assert _score(r1, "OnePlus 12", ["OnePlus", "12"]) > _score(r2, "OnePlus 12", ["OnePlus", "12"])


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
