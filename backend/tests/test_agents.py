"""Hub-spoke multi-agent tests. These exercise the deterministic source spokes
and the aggregator directly — no LLM/model API calls are involved at all."""

import asyncio

import pytest

from app.agents.aggregator import AggregatorAgent
from app.agents.amazon_agent import AmazonAgent
from app.agents.base import SearchFilters, SourceAgent, SourceResult, apply_filters
from app.agents.flipkart_agent import FlipkartAgent
from app.agents.salesforce_agent import SalesforceAgent
from app.models.schemas import ProductListing


def listing(id_: str, title: str, source: str, times: int | None = None) -> ProductListing:
    return ProductListing(id=id_, title=title, source=source, times_purchased=times)


# ───────────────────────── Spoke agents ─────────────────────────


@pytest.mark.asyncio
async def test_salesforce_agent_returns_ranked_listings(monkeypatch, happy_path_records):
    import app.agents.salesforce_agent as sf_mod

    async def fake_search(query, limit=None):
        return happy_path_records

    monkeypatch.setattr(sf_mod.salesforce_client, "search_products", fake_search)
    res = await SalesforceAgent().search("carrot", 3)

    assert res.status == "ok"
    assert res.source == "Salesforce catalog"
    assert len(res.listings) > 0
    assert all(p.origin == "catalog" for p in res.listings)


@pytest.mark.asyncio
async def test_salesforce_agent_empty(monkeypatch):
    import app.agents.salesforce_agent as sf_mod

    async def fake_search(query, limit=None):
        return []

    monkeypatch.setattr(sf_mod.salesforce_client, "search_products", fake_search)
    res = await SalesforceAgent().search("zzz", 3)

    assert res.status == "empty"
    assert res.listings == []


@pytest.mark.asyncio
async def test_flipkart_agent(monkeypatch):
    import app.agents.flipkart_agent as fk_mod

    async def fake_flipkart(query, limit):
        return [listing("u1", "Carrot 1kg", "Flipkart")]

    monkeypatch.setattr(fk_mod, "search_flipkart", fake_flipkart)
    res = await FlipkartAgent().search("carrot", 3)

    assert res.status == "ok"
    assert res.source == "Flipkart (live)"
    assert res.listings[0].source == "Flipkart"
    assert res.listings[0].origin == "live"


@pytest.mark.asyncio
async def test_amazon_agent(monkeypatch):
    import app.agents.amazon_agent as am_mod

    async def fake_amazon(query, limit):
        return [listing("u1", "Carrot 1kg", "Amazon")]

    monkeypatch.setattr(am_mod, "search_amazon", fake_amazon)
    res = await AmazonAgent().search("carrot", 3)

    assert res.status == "ok"
    assert res.source == "Amazon (live)"
    assert res.listings[0].source == "Amazon"
    assert res.listings[0].origin == "live"


# ───────────────────────── Aggregator (hub) ─────────────────────────


class _StubSpoke(SourceAgent):
    def __init__(self, name, result=None, sleep=0.0, raise_exc=None, covers_source=None):
        self.name = name
        self._result = result
        self._sleep = sleep
        self._raise = raise_exc
        self.covers_source = covers_source
        self.called = False

    async def search(self, query, limit, filters=None, exclude_titles=None):
        self.called = True
        self.last_exclude_titles = exclude_titles
        if self._sleep:
            await asyncio.sleep(self._sleep)
        if self._raise:
            raise self._raise
        return self._result


@pytest.mark.asyncio
async def test_tiered_skips_live_when_catalog_covers_source():
    """When the catalog already has a Flipkart product, the live Flipkart site
    is never touched."""
    catalog = _StubSpoke(
        "sf", SourceResult("Salesforce catalog", [listing("1", "Spring Onion", "Flipkart")])
    )
    live = _StubSpoke(
        "fk", SourceResult("Flipkart (live)", [listing("2", "Onion", "Flipkart")]),
        covers_source="Flipkart",
    )

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[live],
        min_catalog_results=1, enrich_history=False,
    )
    res = await agg.search("spring onion", 3)

    assert live.called is False  # catalog had a Flipkart item → no website hit
    assert len(res.listings) == 1
    assert {s.source for s in res.sources} == {"Salesforce catalog"}


@pytest.mark.asyncio
async def test_tiered_covers_source_variants_by_prefix():
    """Catalog sources like "Amazon Now" / "Amazon Fresh" count as coverage for
    the live spoke that covers "Amazon" — no pointless live scrape."""
    catalog = _StubSpoke(
        "sf",
        SourceResult(
            "Salesforce catalog",
            [
                listing("1", "Toned Milk", "Amazon Now"),
                listing("2", "Cow Milk", "Amazon Fresh"),
            ],
        ),
    )
    am = _StubSpoke(
        "am", SourceResult("Amazon (live)", [listing("3", "Milk", "Amazon")]),
        covers_source="Amazon",
    )

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[am],
        min_catalog_results=1, enrich_history=False,
    )
    res = await agg.search("milk", 3)

    assert am.called is False  # "Amazon Now"/"Amazon Fresh" cover the Amazon spoke
    assert len(res.listings) == 2


@pytest.mark.asyncio
async def test_tiered_runs_only_uncovered_live_sources():
    """Catalog has Flipkart but NOT Amazon → skip live Flipkart, run live Amazon."""
    catalog = _StubSpoke(
        "sf", SourceResult("Salesforce catalog", [listing("1", "Atta 5kg", "Flipkart")])
    )
    fk = _StubSpoke(
        "fk", SourceResult("Flipkart (live)", [listing("2", "Atta", "Flipkart")]),
        covers_source="Flipkart",
    )
    am = _StubSpoke(
        "am", SourceResult("Amazon (live)", [listing("3", "Atta", "Amazon")]),
        covers_source="Amazon",
    )

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[fk, am],
        min_catalog_results=1, enrich_history=False,
    )
    res = await agg.search("atta", 3)

    assert fk.called is False  # Flipkart already covered by the catalog
    assert am.called is True  # Amazon missing from catalog → go live
    assert {p.source for p in res.listings} == {"Flipkart", "Amazon"}


@pytest.mark.asyncio
async def test_tiered_falls_back_to_live_when_catalog_thin():
    """Empty catalog → fan out to the live websites and merge."""
    catalog = _StubSpoke("sf", SourceResult("Salesforce catalog", [], "empty"))
    fk = _StubSpoke("fk", SourceResult("Flipkart (live)", [listing("2", "Onion", "Flipkart")]))
    am = _StubSpoke("am", SourceResult("Amazon (live)", [], "not_implemented"))

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[fk, am],
        min_catalog_results=1, enrich_history=False,
    )
    res = await agg.search("rare item", 3)

    assert fk.called is True
    assert len(res.listings) == 1
    assert {s.status for s in res.sources} == {"empty", "ok", "not_implemented"}


@pytest.mark.asyncio
async def test_aggregator_times_out_slow_spoke():
    fast = _StubSpoke(
        "fast", SourceResult("Flipkart (live)", [listing("1", "Carrot", "Flipkart")])
    )
    slow = _StubSpoke(
        "slow", SourceResult("Amazon (live)", [listing("2", "X", "Amazon")]), sleep=1.0
    )

    # Empty catalog forces the live tier to run.
    agg = AggregatorAgent(
        primary_spokes=[_StubSpoke("sf", SourceResult("Salesforce catalog", []))],
        live_spokes=[fast, slow],
        spoke_timeout=0.05, enrich_history=False,
    )
    res = await agg.search("x", 3)

    # Fast spoke contributes; slow one is reported as a timeout with no listings.
    assert len(res.listings) == 1
    statuses = {s.source: s.status for s in res.sources}
    assert statuses["slow"] == "timeout"
    assert statuses["Flipkart (live)"] == "ok"


@pytest.mark.asyncio
async def test_aggregator_handles_spoke_error():
    ok = _StubSpoke("ok", SourceResult("Flipkart (live)", [listing("1", "Carrot", "Flipkart")]))
    boom = _StubSpoke("boom", raise_exc=RuntimeError("kaboom"))

    agg = AggregatorAgent(
        primary_spokes=[_StubSpoke("sf", SourceResult("Salesforce catalog", []))],
        live_spokes=[ok, boom],
        spoke_timeout=5.0, enrich_history=False,
    )
    res = await agg.search("x", 3)

    assert len(res.listings) == 1  # one spoke failing doesn't sink the search
    err = next(s for s in res.sources if s.source == "boom")
    assert err.status == "error"
    assert "kaboom" in (err.detail or "")


@pytest.mark.asyncio
async def test_aggregator_dedupes_by_source_title_prefers_history():
    # Same (source, title) across tiers — keep the entry with purchase history.
    # min_catalog high so the live tier also runs and a dedup is forced.
    catalog = _StubSpoke(
        "catalog",
        SourceResult("Salesforce catalog", [listing("sf", "Carrot 1kg", "Flipkart", times=7)]),
    )
    live = _StubSpoke(
        "live", SourceResult("Flipkart (live)", [listing("u", "Carrot 1kg", "Flipkart")])
    )

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[live],
        min_catalog_results=5, enrich_history=False,
    )
    res = await agg.search("carrot", 3)

    assert len(res.listings) == 1
    assert res.listings[0].times_purchased == 7  # history-bearing entry won


@pytest.mark.asyncio
async def test_aggregator_does_not_collapse_empty_titles():
    # Two distinct Flipkart rows with no title must not merge into one (guards the
    # field-rename bug where every live row had title="").
    live = _StubSpoke(
        "live",
        SourceResult(
            "Flipkart (live)",
            [
                listing("u1", "", "Flipkart"),
                listing("u2", "", "Flipkart"),
            ],
        ),
    )
    agg = AggregatorAgent(
        primary_spokes=[], live_spokes=[live], enrich_history=False
    )
    res = await agg.search_live("carrot", 3)

    assert {p.id for p in res.listings} == {"u1", "u2"}


# ───────────────────── Progressive phases: search_catalog / search_live ───────


@pytest.mark.asyncio
async def test_search_catalog_reports_uncovered_without_running_live():
    catalog = _StubSpoke(
        "sf", SourceResult("Salesforce catalog", [listing("1", "Atta", "Flipkart")])
    )
    fk = _StubSpoke("fk", SourceResult("Flipkart (live)", []), covers_source="Flipkart")
    am = _StubSpoke("am", SourceResult("Amazon (live)", []), covers_source="Amazon")

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[fk, am],
        min_catalog_results=1, enrich_history=False,
    )
    result, uncovered = await agg.search_catalog("atta", 3)

    assert len(result.listings) == 1
    assert fk.called is False and am.called is False  # phase 1 never touches live
    # uncovered lists spoke *names*; Flipkart (covers "Flipkart") is covered by the
    # catalog, Amazon is not.
    assert uncovered == ["am"]


@pytest.mark.asyncio
async def test_search_catalog_force_live_sources():
    catalog = _StubSpoke(
        "sf", SourceResult("Salesforce catalog", [
            listing("1", "Atta", "Flipkart"),
            listing("2", "Oil", "Amazon")
        ])
    )
    fk = _StubSpoke("fk", SourceResult("Flipkart (live)", []), covers_source="Flipkart")
    am = _StubSpoke("am", SourceResult("Amazon (live)", []), covers_source="Amazon")

    agg = AggregatorAgent(
        primary_spokes=[catalog], live_spokes=[fk, am],
        min_catalog_results=1, enrich_history=False,
    )

    # Normally both sources are covered
    _, uncovered = await agg.search_catalog("atta", 3)
    assert uncovered == []

    # Forcing fk makes it show up in uncovered
    _, uncovered = await agg.search_catalog("atta", 3, force_live_sources=["fk"])
    assert uncovered == ["fk"]


@pytest.mark.asyncio
async def test_search_live_runs_only_named_sources():
    fk = _StubSpoke("fk", SourceResult("Flipkart (live)", [listing("2", "Onion", "Flipkart")]))
    am = _StubSpoke("am", SourceResult("Amazon (live)", [listing("3", "Onion", "Amazon")]))

    agg = AggregatorAgent(primary_spokes=[], live_spokes=[fk, am], enrich_history=False)
    result = await agg.search_live("onion", 3, source_names=["am"])  # match by spoke name

    assert am.called is True and fk.called is False
    assert {p.source for p in result.listings} == {"Amazon"}


# ───────────────────── Flipkart capabilities: filters / ranking / enrichment ──


def test_searchfilters_matches():
    f = SearchFilters(max_price=50)
    assert f.matches(40) is True
    assert f.matches(60) is False
    assert f.matches(None) is False  # unknown price dropped when a bound is active
    assert SearchFilters().matches(None) is True  # no bound → keep everything


def test_apply_filters_drops_out_of_range():
    listings = [
        listing("a", "x", "Flipkart"),  # current_price=None
        ProductListing(id="b", title="x", source="Flipkart", current_price=40),
        ProductListing(id="c", title="x", source="Flipkart", current_price=120),
    ]
    out = apply_filters(listings, SearchFilters(max_price=50))
    assert [p.id for p in out] == ["b"]


@pytest.mark.asyncio
async def test_flipkart_agent_ranks_by_value(monkeypatch):
    import app.agents.flipkart_agent as fk_mod

    async def fake_flipkart(query, limit):
        return [
            ProductListing(id="a", title="Carrot A", source="Flipkart",
                           current_price=100, rating="3.0", review_count=10),
            ProductListing(id="b", title="Carrot B", source="Flipkart",
                           current_price=50, rating="4.8", review_count=500),
            ProductListing(id="c", title="Carrot C", source="Flipkart",
                           current_price=80, rating="4.0", review_count=50),
        ]

    monkeypatch.setattr(fk_mod, "search_flipkart", fake_flipkart)
    res = await FlipkartAgent().search("carrot", 2)

    assert [p.id for p in res.listings] == ["b", "c"]  # best value first, capped at 2


@pytest.mark.asyncio
async def test_flipkart_agent_ranks_query_matches_first(monkeypatch):
    """Live search returns nearby veg; the actually-searched item ranks first even
    when it isn't the cheapest."""
    import app.agents.flipkart_agent as fk_mod

    async def fake_flipkart(query, limit):
        return [
            ProductListing(id="t", title="Local Tomato", source="Flipkart", current_price=14),
            ProductListing(id="c", title="Local Carrot", source="Flipkart", current_price=25),
            ProductListing(id="b", title="Beetroot", source="Flipkart", current_price=25),
        ]

    monkeypatch.setattr(fk_mod, "search_flipkart", fake_flipkart)
    res = await FlipkartAgent().search("carrot", 3)

    assert res.listings[0].title == "Local Carrot"  # matches "carrot" → first, despite ₹25 > ₹14


@pytest.mark.asyncio
async def test_flipkart_agent_honors_price_filter(monkeypatch):
    import app.agents.flipkart_agent as fk_mod

    async def fake_flipkart(query, limit):
        return [
            ProductListing(id="cheap", title="Carrot", source="Flipkart", current_price=40),
            ProductListing(id="pricey", title="Carrot", source="Flipkart", current_price=120),
        ]

    monkeypatch.setattr(fk_mod, "search_flipkart", fake_flipkart)
    res = await FlipkartAgent().search("carrot", 3, SearchFilters(max_price=50))

    assert [p.id for p in res.listings] == ["cheap"]


def test_flipkart_enrich_annotates_history():
    history = {
        "aashirvaad atta 5kg": ProductListing(
            id="h", title="Aashirvaad Atta 5kg", source="Flipkart",
            times_purchased=5, buy_suggestion="frequent", suggestion_reason="Bought 5x",
            last_ordered_date="2026-05-01",
        )
    }
    live = [ProductListing(id="u", title="Aashirvaad Atta 5kg", source="Flipkart",
                           buy_suggestion="new")]
    out = FlipkartAgent().enrich(live, history)

    assert out[0].buy_suggestion == "frequent"
    assert out[0].times_purchased == 5
    assert out[0].suggestion_reason == "Bought 5x"


@pytest.mark.asyncio
async def test_aggregator_enriches_live_results_end_to_end(monkeypatch):
    """A live Flipkart result for a product the user buys gets annotated with
    purchase history — no model calls involved."""
    import app.agents.aggregator as agg_mod
    import app.agents.flipkart_agent as fk_mod

    async def fake_flipkart(query, limit):
        return [ProductListing(id="u", title="Aashirvaad Atta 5kg", source="Flipkart",
                               current_price=249.0, buy_suggestion="new")]

    async def fake_recent(days=7, limit=None):
        return [{
            "Id": "a1",
            "Title__c": "Aashirvaad Atta 5kg",
            "Source__c": "Flipkart",
            "Number_Of_Times_Purchased__c": 5,
            "Last_Ordered_Date__c": "2026-05-01",
        }]

    monkeypatch.setattr(fk_mod, "search_flipkart", fake_flipkart)
    monkeypatch.setattr(agg_mod.salesforce_client, "get_recent_products", fake_recent)

    # Empty catalog so the live tier (FlipkartAgent) runs and gets enriched.
    agg = AggregatorAgent(
        primary_spokes=[], live_spokes=[FlipkartAgent()],
        spoke_timeout=5.0, enrich_history=True,
    )
    res = await agg.search("atta", 3)

    assert len(res.listings) == 1
    assert res.listings[0].times_purchased == 5
    assert res.listings[0].buy_suggestion == "frequent"  # was "new" before enrichment


@pytest.mark.asyncio
async def test_search_live_excludes_already_found_titles(monkeypatch):
    import app.agents.aggregator as agg_mod

    async def fake_search(query):
        return [
            {"Title__c": "Tata Sampan Chicken Masala", "Source__c": "Amazon Fresh"},
            {"Title__c": "Tata Sampan Turmeric Powder", "Source__c": "Amazon Fresh"},
        ]

    monkeypatch.setattr(agg_mod.salesforce_client, "search_products", fake_search)

    # Spoke returns three products, one of which matches the Salesforce catalog product
    live_spoke = _StubSpoke(
        "am",
        SourceResult(
            "Amazon (live)",
            [
                listing("1", "Tata Sampan Chicken Masala", "Amazon Fresh"),
                listing("2", "Tata Sampan Coriander Powder", "Amazon Fresh"),
                listing("3", "Tata Sampan Chilli Powder", "Amazon Fresh"),
            ]
        ),
        covers_source="Amazon"
    )

    agg = AggregatorAgent(primary_spokes=[], live_spokes=[live_spoke], enrich_history=False)
    await agg.search_live("chicken", 3)

    assert live_spoke.called is True
    assert live_spoke.last_exclude_titles == {
        "tata sampan chicken masala",
        "tata sampan turmeric powder",
    }
