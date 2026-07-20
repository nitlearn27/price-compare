import json

import httpx
import pytest
import respx

from app.models.schemas import AgentCartItem, CartCheckoutResponse, ChatMessage
from app.services.agent import ShoppingAgent

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"  # primary provider


def search_call(query: str, tokens: int = 0) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "c1",
                            "type": "function",
                            "function": {
                                "name": "search_products",
                                "arguments": json.dumps({"query": query}),
                            },
                        }
                    ],
                }
            }
        ],
        "usage": {"total_tokens": tokens},
    }


def text_response(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


def tool_call(name: str, args: dict, cid: str = "c1") -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": cid,
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(args)},
                        }
                    ],
                }
            }
        ],
        "usage": {"total_tokens": 0},
    }


def make_agent():
    import app.core.config as cfg

    agent = ShoppingAgent()
    agent._settings = cfg.get_settings()  # monkeypatched in conftest → test settings
    return agent


def stub_aggregator(monkeypatch, listings=None, uncovered=None):
    """Replace the catalog phase with a deterministic stub so the loop tests never
    trigger real source HTTP calls. `uncovered` are live sources still owed (→
    pending_live). Returns the listings used."""
    import app.services.agent as agent_mod
    from app.agents.aggregator import AggregatedResult
    from app.agents.base import SourceResult

    listings = listings or []
    uncovered = uncovered or []

    async def fake_search_catalog(query, limit, filters=None, **kwargs):
        agg = AggregatedResult(
            listings=listings,
            sources=[
                SourceResult("Salesforce catalog", listings, "ok" if listings else "empty")
            ],
        )
        return agg, uncovered

    monkeypatch.setattr(agent_mod.aggregator_agent, "search_catalog", fake_search_catalog)
    return listings


@respx.mock
@pytest.mark.asyncio
async def test_loop_searches_then_returns_final_reply(monkeypatch, happy_path_records):
    """The agent calls a tool, the result is fed back, and a second model call
    produces the final answer — i.e. a real two-iteration agentic loop."""
    from app.services.product_search import rank_and_group

    listings = stub_aggregator(monkeypatch, rank_and_group(happy_path_records, "x", 3))
    assert listings  # sanity: the fixture produced listings

    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("pen drive")),
            httpx.Response(200, json=text_response("Best value is the Flipkart one.")),
        ]
    )

    agent = make_agent()
    resp = await agent.run([ChatMessage(role="user", content="cheapest pen drive")])

    assert resp.reply == "Best value is the Flipkart one."
    assert len(resp.results) > 0  # aggregated results absorbed into the UI table
    assert respx.calls.call_count == 2  # tool round-trip + final answer


@respx.mock
@pytest.mark.asyncio
async def test_thin_catalog_returns_pending_live(monkeypatch):
    """When the catalog doesn't cover a live source, the agent reports pending_live
    so the frontend can fetch + append it (progressive loading)."""
    stub_aggregator(monkeypatch, listings=[], uncovered=["flipkart"])
    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("carrot")),
            httpx.Response(200, json=text_response("Fetching live Flipkart results too…")),
        ]
    )

    agent = make_agent()
    resp = await agent.run([ChatMessage(role="user", content="carrot")])

    assert resp.pending_live is not None
    assert resp.pending_live.query == "carrot"
    assert resp.pending_live.sources == ["flipkart"]


@respx.mock
@pytest.mark.asyncio
async def test_plain_reply_makes_no_tool_calls(happy_path_records):
    respx.post(DEEPSEEK_URL).mock(
        return_value=httpx.Response(200, json=text_response("Hi! How can I help?"))
    )
    agent = make_agent()
    resp = await agent.run([ChatMessage(role="user", content="hello")])

    assert resp.reply == "Hi! How can I help?"
    assert resp.results == []
    assert respx.calls.call_count == 1


@respx.mock
@pytest.mark.asyncio
async def test_chat_falls_back_to_openrouter():
    """DeepSeek is primary; if it errors, the call transparently retries on
    OpenRouter and the loop continues."""
    respx.post(DEEPSEEK_URL).mock(return_value=httpx.Response(500, json={"error": "down"}))
    respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(200, json=text_response("Hi from OpenRouter"))
    )
    agent = make_agent()
    resp = await agent.run([ChatMessage(role="user", content="hello")])

    assert resp.reply == "Hi from OpenRouter"
    assert respx.calls.call_count == 2  # DeepSeek failed, OpenRouter succeeded


@respx.mock
@pytest.mark.asyncio
async def test_loop_cap_stops_after_max_steps(monkeypatch):
    """Guardrail: a model that never stops asking for tools is bounded by
    agent_max_steps, then forced to answer with tools disabled."""
    stub_aggregator(monkeypatch)
    respx.post(DEEPSEEK_URL).mock(return_value=httpx.Response(200, json=search_call("x")))

    agent = make_agent()
    agent._settings = agent._settings.model_copy(update={"agent_max_steps": 2})
    resp = await agent.run([ChatMessage(role="user", content="loop forever")])

    # 2 loop steps + 1 final tools-disabled call.
    assert respx.calls.call_count == 3
    assert resp.reply  # falls back to a graceful message


@respx.mock
@pytest.mark.asyncio
async def test_token_budget_breaks_loop(monkeypatch):
    """Guardrail: once cumulative usage exceeds the budget, the loop stops early."""
    stub_aggregator(monkeypatch)
    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("x", tokens=999_999)),
            httpx.Response(200, json=text_response("Stopped early due to budget.")),
        ]
    )

    agent = make_agent()
    agent._settings = agent._settings.model_copy(update={"agent_token_budget": 100})
    resp = await agent.run([ChatMessage(role="user", content="big request")])

    # 1 step (budget blown) + 1 final call — well under agent_max_steps (6).
    assert respx.calls.call_count == 2
    assert resp.reply == "Stopped early due to budget."


@pytest.mark.asyncio
async def test_add_to_cart_dedupes():
    agent = make_agent()
    cart: dict = {}
    out, _, _ = await agent._dispatch(
        "add_to_cart",
        {
            "items": [
                {"title": "Atta 5kg", "source": "Flipkart"},
                {"title": "Atta 5kg", "source": "Flipkart"},
            ]
        },
        [],
        set(),
        cart,
    )
    assert len(cart) == 1
    assert out["cart_size"] == 1


@pytest.mark.asyncio
async def test_checkout_gate_blocks_unconfirmed(monkeypatch):
    """The money gate: an unconfirmed checkout must NOT submit the cart."""
    from app.services import agent as agent_mod

    called = False

    async def fake_submit(products):
        nonlocal called
        called = True
        return CartCheckoutResponse(submitted=len(products), detail="ok")

    monkeypatch.setattr(agent_mod, "submit_cart", fake_submit)

    agent = make_agent()
    cart = {"k": AgentCartItem(id="k", name="Atta 5kg", source="Flipkart")}
    out, ckout, _ = await agent._dispatch("checkout", {"confirmed": False}, [], set(), cart)

    assert out["status"] == "confirmation_required"
    assert ckout is None
    assert called is False
    assert cart  # cart untouched


@pytest.mark.asyncio
async def test_checkout_confirmed_submits_and_clears_cart(monkeypatch):
    from app.services import agent as agent_mod

    async def fake_submit(products):
        assert products == [{"name": "Atta 5kg", "source": "Flipkart"}]
        return CartCheckoutResponse(submitted=1, detail="Submitted 1 item(s).")

    monkeypatch.setattr(agent_mod, "submit_cart", fake_submit)

    agent = make_agent()
    cart = {"k": AgentCartItem(id="k", name="Atta 5kg", source="Flipkart")}
    out, ckout, _ = await agent._dispatch("checkout", {"confirmed": True}, [], set(), cart)

    assert out["status"] == "ordered"
    assert ckout.submitted == 1
    assert cart == {}  # cleared after a successful order


@respx.mock
@pytest.mark.asyncio
async def test_stream_emits_status_results_reply_done(monkeypatch, happy_path_records):
    """The SSE stream surfaces the loop's progress: a status when a tool runs,
    the results as the search lands, the reply, then a terminal `done` snapshot."""
    from app.services.product_search import rank_and_group

    stub_aggregator(monkeypatch, rank_and_group(happy_path_records, "x", 3))
    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("pen drive")),
            httpx.Response(200, json=text_response("Best value is the Flipkart one.")),
        ]
    )

    agent = make_agent()
    events = [ev async for ev in agent.run_stream([ChatMessage(role="user", content="pen drive")])]
    names = [name for name, _ in events]

    assert names[0] == "status"  # "Searching the catalog…" before the tool runs
    assert "results" in names
    assert "reply" in names
    assert names[-1] == "done"

    done = next(data for name, data in events if name == "done")
    assert done["reply"] == "Best value is the Flipkart one."
    assert len(done["results"]) > 0


@respx.mock
@pytest.mark.asyncio
async def test_cart_persists_across_turns(monkeypatch):
    """With a thread_id, the checkpointer keeps the cart between turns: an item
    added in turn 1 is still there to check out in turn 2 (the headline fix — the
    old stateless loop rebuilt an empty cart every request)."""
    from app.services import agent as agent_mod

    submitted: dict = {}

    async def fake_submit(products):
        submitted["products"] = products
        return CartCheckoutResponse(submitted=len(products), detail="Submitted 1 item(s).")

    monkeypatch.setattr(agent_mod, "submit_cart", fake_submit)

    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            # Turn 1: add an item, then reply.
            httpx.Response(
                200,
                json=tool_call(
                    "add_to_cart", {"items": [{"title": "Atta 5kg", "source": "Flipkart"}]}
                ),
            ),
            httpx.Response(200, json=text_response("Added Atta 5kg to your cart.")),
            # Turn 2 (same thread): confirmed checkout, then reply.
            httpx.Response(200, json=tool_call("checkout", {"confirmed": True})),
            httpx.Response(200, json=text_response("Order placed.")),
        ]
    )

    agent = make_agent()

    r1 = await agent.run([ChatMessage(role="user", content="add atta")], thread_id="t1")
    assert r1.thread_id == "t1"
    assert [c.name for c in r1.cart] == ["Atta 5kg"]

    # New turn sends ONLY the latest user message — history + cart come from state.
    r2 = await agent.run([ChatMessage(role="user", content="yes, order it")], thread_id="t1")

    # The item added in turn 1 survived into turn 2 and was submitted.
    assert submitted["products"] == [{"name": "Atta 5kg", "source": "Flipkart"}]
    assert r2.checkout is not None and r2.checkout.submitted == 1
    assert r2.cart == []  # cleared after the order


# ── validate node (semantic relevance pass) ──────────────────────────────────

# Three rows all containing "butter" (so the deterministic filter keeps them); the
# validate pass then drops the non-butter row.
_BUTTER_RECORDS = [
    {"Id": "1", "Title__c": "Amul Butter 500g", "Source__c": "Flipkart"},
    {"Id": "2", "Title__c": "Nandini Butter 100g", "Source__c": "Flipkart"},
    {"Id": "3", "Title__c": "Butter Chicken Masala", "Source__c": "Flipkart"},
]


@respx.mock
@pytest.mark.asyncio
async def test_validate_node_drops_irrelevant_rows(monkeypatch):
    from app.services.product_search import rank_and_group

    stub_aggregator(monkeypatch, rank_and_group(_BUTTER_RECORDS, "butter", 3))
    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("butter")),
            httpx.Response(200, json=text_response("[0,1]")),  # keep Amul + Nandini
            httpx.Response(200, json=text_response("Two good butters.")),
        ]
    )

    agent = make_agent()
    agent._settings.agent_validate_relevance = True
    resp = await agent.run([ChatMessage(role="user", content="butter")])

    assert [r.title for r in resp.results] == ["Amul Butter 500g", "Nandini Butter 100g"]
    assert resp.reply == "Two good butters."
    assert respx.calls.call_count == 3  # search + validate + final reply

    # The reply-generation call (last) carries a relevance note listing ONLY the
    # kept rows, so the model's prose table matches the grid.
    final_body = respx.calls[-1].request.content.decode()
    assert "Relevance filter applied" in final_body
    assert "- Amul Butter 500g (Flipkart)" in final_body
    assert "- Butter Chicken Masala" not in final_body


@respx.mock
@pytest.mark.asyncio
async def test_validate_node_fails_open_on_unparseable_reply(monkeypatch):
    from app.services.product_search import rank_and_group

    stub_aggregator(monkeypatch, rank_and_group(_BUTTER_RECORDS, "butter", 3))
    respx.post(DEEPSEEK_URL).mock(
        side_effect=[
            httpx.Response(200, json=search_call("butter")),
            httpx.Response(200, json=text_response("sorry, not sure")),  # no JSON array
            httpx.Response(200, json=text_response("Here you go.")),
        ]
    )

    agent = make_agent()
    agent._settings.agent_validate_relevance = True
    resp = await agent.run([ChatMessage(role="user", content="butter")])

    assert len(resp.results) == 3  # unchanged — fail-open keeps the deterministic set
    assert resp.reply == "Here you go."
