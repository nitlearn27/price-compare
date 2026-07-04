import json

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import ChatMessage, ProductQuery
from app.services.refresh import SOURCE_LABELS, trigger_refresh

logger = get_logger(__name__)

# Maps refresh tool names → source key understood by the refresh service.
_REFRESH_TOOLS: dict[str, str] = {
    "refresh_amazon_products": "amazon",
    "refresh_flipkart_products": "flipkart",
}

_SYSTEM_PROMPT = (
    "You are a helpful shopping assistant for Indian consumers. "
    "When returning search results, always present the response in two sleek sections:\n"
    "1. A clean markdown comparison table of the top matches (columns: Store | Product | "
    "Price | Rating).\n"
    "2. 2-3 brief bullet points (pointers) highlighting the best deal/recommendation based on "
    "price, rating, or history. Do NOT write paragraphs or long sentences. Keep the entire "
    "reply professional, sleek, and highly catchy.\n\n"
    "Whenever the user mentions a product they want to find, compare, or buy — even vaguely "
    "(e.g. 'any pen drive', 'a gaming laptop', 'show me iphones') — you MUST call the "
    "`search_products` tool. Do not ask clarifying questions before searching; call the tool "
    "first, then refine afterwards if needed. "
    "Into the `query` argument put only the core product keywords (brand, model, type, capacity). "
    "Strip filler words like 'give', 'me', 'show', 'find', 'price', 'cost', 'of', 'a', 'an', "
    "'any', 'the', 'best', 'cheap', 'good', 'please'. "
    "Examples: 'Give me price of any pen drive' -> query='pen drive'. "
    "'Find a gaming laptop under 80000' -> query='gaming laptop', max_price=80000. "
    "'Show me the best iPhone 15 Pro 256GB' -> query='iPhone 15 Pro 256GB'. "
    "If the user asks to refresh, update, reload, or re-scrape the products for a specific store, "
    "call the matching tool instead of `search_products`: 'refresh products for Amazon' / "
    "'refresh Amazon products' -> call `refresh_amazon_products`; 'refresh products for Flipkart' "
    "-> call `refresh_flipkart_products`. These refresh tools take no arguments. "
    "Only reply conversationally (without calling the tool) if the user is clearly NOT asking "
    "about a product (e.g. greetings, thanks). Never invent prices, ratings, or availability."
)

_SEARCH_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "search_products",
        "description": "Search the product catalog for items matching the user's request.",
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The product search string, e.g. 'iPhone 15 Pro 256GB'.",
                },
                "category": {
                    "type": "string",
                    "description": "Product category such as 'mobile', 'laptop', 'tv'.",
                },
                "min_price": {
                    "type": "number",
                    "description": "Minimum price in INR.",
                },
                "max_price": {
                    "type": "number",
                    "description": "Maximum price in INR.",
                },
                "brand": {
                    "type": "string",
                    "description": "Brand name to filter by.",
                },
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Restrict results to specific sources, e.g. ['Amazon'].",
                },
            },
        },
    },
}

_REFRESH_AMAZON_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "refresh_amazon_products",
        "description": (
            "Trigger a backend refresh of the Amazon product catalog. Call this when the user "
            "asks to refresh, update, reload, or re-scrape Amazon products. Takes no arguments."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

_REFRESH_FLIPKART_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "refresh_flipkart_products",
        "description": (
            "Trigger a backend refresh of the Flipkart product catalog. Call this when the user "
            "asks to refresh, update, reload, or re-scrape Flipkart products. Takes no arguments."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


class OpenRouterClient:
    _BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self) -> None:
        self._settings = get_settings()

    async def chat(self, messages: list[ChatMessage]) -> tuple[str, ProductQuery | None]:
        s = self._settings
        payload: dict = {
            "model": s.openrouter_model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                *[{"role": m.role, "content": m.content} for m in messages],
            ],
            "tools": [_SEARCH_TOOL, _REFRESH_AMAZON_TOOL, _REFRESH_FLIPKART_TOOL],
            "tool_choice": "auto",
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self._BASE_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {s.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:5173",
                    "X-Title": "Price Compare",
                },
                timeout=60.0,
            )

        if resp.status_code >= 400:
            logger.error("OpenRouter error: HTTP %s — %s", resp.status_code, resp.text[:200])
            resp.raise_for_status()

        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]

        tool_calls = msg.get("tool_calls") or []
        if tool_calls:
            tc = tool_calls[0]
            name = tc["function"]["name"]

            if name in _REFRESH_TOOLS:
                source = _REFRESH_TOOLS[name]
                await trigger_refresh(source)
                label = SOURCE_LABELS.get(source, source)
                reply = msg.get("content") or (
                    f"Triggered a refresh for {label} products. "
                    "Updated data will appear shortly — search again in a moment."
                )
                logger.info("Tool call: %s", name)
                return reply, None

            try:
                args = json.loads(tc["function"]["arguments"])
            except (json.JSONDecodeError, KeyError) as exc:
                logger.error("Failed to parse tool call arguments: %s", exc)
                raise ValueError("LLM returned malformed tool call arguments.") from exc

            product_query = ProductQuery(**args)
            reply = msg.get("content") or f"Searching for **{product_query.query}**…"
            logger.info("Tool call: search_products query=%r", product_query.query)
            return reply, product_query

        reply = msg.get("content") or ""
        logger.debug("Conversational reply length=%d", len(reply))
        return reply, None


openrouter_client = OpenRouterClient()
