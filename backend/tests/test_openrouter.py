import json

import httpx
import pytest
import respx

from app.models.schemas import ChatMessage
from app.services.openrouter import OpenRouterClient

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def make_client() -> OpenRouterClient:
    c = OpenRouterClient()
    return c


def tool_call_response(query: str, extra_args: dict | None = None) -> dict:
    args = {"query": query}
    if extra_args:
        args.update(extra_args)
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_abc",
                            "type": "function",
                            "function": {
                                "name": "search_products",
                                "arguments": json.dumps(args),
                            },
                        }
                    ],
                }
            }
        ]
    }


def text_response(content: str) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": None,
                }
            }
        ]
    }


MESSAGES = [ChatMessage(role="user", content="Find me a OnePlus 12")]


@pytest.mark.asyncio
async def test_request_includes_system_prompt_and_tool():
    client = make_client()
    with respx.mock:
        route = respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(200, json=tool_call_response("OnePlus 12"))
        )
        await client.chat(MESSAGES)

    payload = json.loads(route.calls[0].request.content)
    roles = [m["role"] for m in payload["messages"]]
    assert "system" in roles
    assert payload["tools"][0]["function"]["name"] == "search_products"
    assert payload["tool_choice"] == "auto"


@pytest.mark.asyncio
async def test_tool_call_returns_product_query():
    client = make_client()
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(200, json=tool_call_response("OnePlus 12"))
        )
        reply, pq = await client.chat(MESSAGES)

    assert pq is not None
    assert pq.query == "OnePlus 12"
    assert isinstance(reply, str)


@pytest.mark.asyncio
async def test_tool_call_with_full_args():
    client = make_client()
    extra = {"category": "mobile", "min_price": 40000, "max_price": 80000, "brand": "OnePlus"}
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(200, json=tool_call_response("OnePlus 12", extra))
        )
        _, pq = await client.chat(MESSAGES)

    assert pq.category == "mobile"
    assert pq.min_price == 40000
    assert pq.max_price == 80000
    assert pq.brand == "OnePlus"


@pytest.mark.asyncio
async def test_plain_reply_returns_none_query():
    client = make_client()
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(200, json=text_response("What's your budget?"))
        )
        reply, pq = await client.chat(MESSAGES)

    assert pq is None
    assert reply == "What's your budget?"


@pytest.mark.asyncio
async def test_4xx_raises():
    client = make_client()
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )
        with pytest.raises(httpx.HTTPStatusError):
            await client.chat(MESSAGES)


@pytest.mark.asyncio
async def test_5xx_raises():
    client = make_client()
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(503, text="Service unavailable")
        )
        with pytest.raises(httpx.HTTPStatusError):
            await client.chat(MESSAGES)


@pytest.mark.asyncio
async def test_timeout_raises():
    client = make_client()
    with respx.mock:
        respx.post(OPENROUTER_URL).mock(side_effect=httpx.TimeoutException("timeout"))
        with pytest.raises(httpx.TimeoutException):
            await client.chat(MESSAGES)


@pytest.mark.asyncio
async def test_full_conversation_history_forwarded():
    client = make_client()
    messages = [
        ChatMessage(role="user", content="Hello"),
        ChatMessage(role="assistant", content="Hi! What are you looking for?"),
        ChatMessage(role="user", content="OnePlus 12"),
    ]
    with respx.mock:
        route = respx.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(200, json=tool_call_response("OnePlus 12"))
        )
        await client.chat(messages)

    payload = json.loads(route.calls[0].request.content)
    # system + 3 user/assistant messages
    assert len(payload["messages"]) == 4
