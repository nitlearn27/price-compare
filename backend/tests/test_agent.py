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


def make_agent():
    import app.core.config as cfg

    agent = ShoppingAgent()
    agent._settings = cfg.get_settings()  # monkeypatched in conftest → test settings
    return agent


def stub_aggregator(monkeypatch, listings=None):
    """Replace the hub-spoke aggregator with a deterministic stub so the loop
    tests never trigger real source HTTP calls. Returns the listings used."""
    import app.services.agent as agent_mod
    from app.agents.aggregator import AggregatedResult
    from app.agents.base import SourceResult

    listings = listings or []

    async def fake_search(query, limit, filters=None):
        return AggregatedResult(
            listings=listings,
            sources=[
                SourceResult("Salesforce catalog", listings, "ok" if listings else "empty")
            ],
        )

    monkeypatch.setattr(agent_mod.aggregator_agent, "search", fake_search)
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
    out, _ = await agent._dispatch(
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
    out, ckout = await agent._dispatch("checkout", {"confirmed": False}, [], set(), cart)

    assert out["status"] == "confirmation_required"
    assert ckout is None
    assert called is False
    assert cart  # cart untouched


@pytest.mark.asyncio
async def test_checkout_confirmed_submits_and_clears_cart(monkeypatch):
    from app.services import agent as agent_mod

    async def fake_submit(products):
        assert products == ["Atta 5kg"]
        return CartCheckoutResponse(submitted=1, detail="Submitted 1 item(s).")

    monkeypatch.setattr(agent_mod, "submit_cart", fake_submit)

    agent = make_agent()
    cart = {"k": AgentCartItem(id="k", name="Atta 5kg", source="Flipkart")}
    out, ckout = await agent._dispatch("checkout", {"confirmed": True}, [], set(), cart)

    assert out["status"] == "ordered"
    assert ckout.submitted == 1
    assert cart == {}  # cleared after a successful order
