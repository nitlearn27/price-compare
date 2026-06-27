"""The shopping agent — a real agentic tool-use loop.

Unlike ``openrouter.py`` (which makes ONE model call and reads only the tool
*arguments*), this runs the classic agentic loop:

    while the model wants to use a tool:
        execute the tool  →  feed the RESULT back to the model  →  let it re-reason

The model therefore *observes* real Salesforce / Flipkart data, decides the next
action (search again, fall back to live results, recommend the best deal, add to
cart), and only stops when it has a final answer for the user. Money-spending
(``checkout``) is gated: the model is instructed never to call it until the user
explicitly confirms, and the tool itself refuses an unconfirmed call.
"""

import json

import httpx

from app.agents.aggregator import aggregator_agent
from app.agents.base import SearchFilters
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.schemas import (
    AgentCartItem,
    AgentResponse,
    ChatMessage,
    ProductListing,
)
from app.services.cart import submit_cart
from app.services.product_search import _normalize
from app.services.refresh import SOURCE_LABELS, trigger_refresh
from app.services.salesforce import salesforce_client

logger = get_logger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# A signature is allowed to execute at most this many times; further identical
# tool calls are short-circuited so a stuck model can't loop on the same action.
# Set to 2 so a refresh→re-search flow still works, but pathological repeats don't.
_MAX_IDENTICAL_CALLS = 2

_SYSTEM_PROMPT = (
    "You are an autonomous shopping agent for an Indian grocery & product app. "
    "Your job is to help the user find the BEST-VALUE products and place orders.\n\n"
    "You work in a loop: call a tool, look at the REAL data it returns, reason, then "
    "act again. Only use values returned by tools — never invent prices, ratings, or "
    "availability.\n\n"
    "FINDING A PRODUCT:\n"
    "1. Call `search_products` with only the core keywords (strip filler like 'give me', "
    "'price of', 'best', 'cheap'). This searches ALL sources at once (Salesforce catalog + "
    "live Flipkart + Amazon) and returns merged results plus a per-source status.\n"
    "2. Read the results. If they are weak, you may `refresh_products` to re-scrape a store "
    "and search again. The `sources` field tells you which sources responded.\n"
    "3. Recommend the BEST option. Weigh current_price (lower is better), rating, "
    "discount, and the user's own history (times_purchased, buy_suggestion — 'restock' "
    "and 'frequent' items are ones they rely on). State your pick in 1-2 lines citing the "
    "real numbers (e.g. 'Flipkart ₹249, 4.5★, you've bought this 5×').\n\n"
    "RESTOCK / 'what do I need':\n"
    "Call `get_purchase_history` to see what the user buys regularly, find the best deal "
    "for each item that needs restocking, then propose a combined cart.\n\n"
    "ORDERING — STRICT MONEY RULE:\n"
    "- Use `add_to_cart` freely (it is reversible).\n"
    "- NEVER call `checkout` until the user has EXPLICITLY confirmed in their LATEST "
    "message ('yes', 'order it', 'place the order'). First PROPOSE the cart: list each "
    "item, its price, and the total, then ASK the user to confirm — on that turn call NO "
    "tool, just ask. Only after they confirm, call `checkout`.\n"
    "- After checkout, tell the user an OTP may be sent to their phone and to paste it here.\n\n"
    "Reply conversationally (no tool) for greetings/thanks and when asking for confirmation."
)

_PRODUCT_TOOL_PROPS = {
    "query": {
        "type": "string",
        "description": "Core product keywords, e.g. 'iPhone 15 Pro 256GB' or 'atta 5kg'.",
    },
    "max_price": {"type": "number", "description": "Maximum price in INR."},
    "min_price": {"type": "number", "description": "Minimum price in INR."},
}

_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": "Search ALL sources at once (Salesforce catalog + live Flipkart + "
            "Amazon) via the aggregator. Returns merged top matches with price, rating, and "
            "the user's purchase history, plus a per-source status.",
            "parameters": {
                "type": "object",
                "required": ["query"],
                "properties": _PRODUCT_TOOL_PROPS,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_purchase_history",
            "description": "List the products the user has ordered recently, with how many "
            "times they bought each and when. Use this for restock recommendations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Look-back window in days (default 30).",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refresh_products",
            "description": "Trigger a re-scrape of a store's catalog into Salesforce. Use "
            "when the user asks to refresh/update a store, or when data looks stale.",
            "parameters": {
                "type": "object",
                "required": ["source"],
                "properties": {
                    "source": {"type": "string", "enum": ["amazon", "flipkart"]}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_cart",
            "description": "Add one or more chosen products to the shopping cart. Reversible.",
            "parameters": {
                "type": "object",
                "required": ["items"],
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["title", "source"],
                            "properties": {
                                "title": {"type": "string"},
                                "source": {"type": "string"},
                            },
                        },
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "checkout",
            "description": "Place the order for everything currently in the cart. ONLY call "
            "this after the user has explicitly confirmed they want to order.",
            "parameters": {
                "type": "object",
                "required": ["confirmed"],
                "properties": {
                    "confirmed": {
                        "type": "boolean",
                        "description": "Must be true, and only set it once the user has "
                        "explicitly confirmed in their latest message.",
                    }
                },
            },
        },
    },
]


def _compact(p: ProductListing) -> dict:
    """Trim a listing to the fields the model needs to reason — keeps tool
    results small so we don't blow the context window."""
    return {
        "title": p.title,
        "source": p.source,
        "origin": p.origin,  # "catalog" or "live" (direct from website)
        "weight": p.weight,
        "current_price": p.current_price,
        "original_price": p.original_price,
        "discount": p.discount,
        "rating": p.rating,
        "times_purchased": p.times_purchased,
        "last_ordered_date": p.last_ordered_date,
        "buy_suggestion": p.buy_suggestion,
    }


class ShoppingAgent:
    def __init__(self) -> None:
        self._settings = get_settings()

    async def run(self, messages: list[ChatMessage]) -> AgentResponse:
        # Side-channel UI state accumulated across tool calls: the comparison
        # table (`results`) and the cart. These are returned to the frontend
        # alongside the model's final text.
        s = self._settings
        results: list[ProductListing] = []
        seen_result_ids: set[str] = set()
        cart: dict[str, AgentCartItem] = {}
        last_checkout = None

        # Guardrail accounting.
        total_tokens = 0  # cumulative usage across the loop
        call_counts: dict[str, int] = {}  # signature → times executed (repeat guard)

        convo: list[dict] = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            *[{"role": m.role, "content": m.content} for m in messages],
        ]

        for step in range(s.agent_max_steps):
            data = await self._call_llm(convo)
            total_tokens += int((data.get("usage") or {}).get("total_tokens") or 0)
            msg = data["choices"][0]["message"]
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                return AgentResponse(
                    reply=msg.get("content") or "",
                    results=results,
                    cart=list(cart.values()),
                    checkout=last_checkout,
                )

            # The assistant message that carries the tool_calls MUST be appended
            # before the matching tool results, or the next call is malformed.
            convo.append(msg)

            for i, tc in enumerate(tool_calls):
                name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}

                # Guardrail: cap the number of tools actually executed per step.
                # We still emit a tool result for every call (required by the API
                # message contract), but skip running the overflow ones.
                if i >= s.agent_max_tool_calls_per_step:
                    output = {"error": "skipped: too many tool calls this step"}
                else:
                    sig = f"{name}:{json.dumps(args, sort_keys=True)}"
                    if call_counts.get(sig, 0) >= _MAX_IDENTICAL_CALLS:
                        output = {"note": "already executed this exact call; do not repeat it"}
                    else:
                        call_counts[sig] = call_counts.get(sig, 0) + 1
                        logger.info("Agent step %d → tool %s args=%s", step, name, args)
                        output, ckout = await self._dispatch(
                            name, args, results, seen_result_ids, cart
                        )
                        if ckout is not None:
                            last_checkout = ckout

                convo.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(output),
                    }
                )

            # Guardrail: stop spending if the cumulative token budget is blown.
            if total_tokens >= s.agent_token_budget:
                logger.warning(
                    "Agent token budget exceeded (%d ≥ %d) — finalizing",
                    total_tokens,
                    s.agent_token_budget,
                )
                break

        # Loop exhausted (step cap or token budget) — ask for a final answer
        # with tools disabled so it must respond in prose.
        data = await self._call_llm(convo, allow_tools=False)
        reply = data["choices"][0]["message"].get("content") or (
            "I wasn't able to finish that — could you rephrase?"
        )
        return AgentResponse(
            reply=reply,
            results=results,
            cart=list(cart.values()),
            checkout=last_checkout,
        )

    async def _dispatch(
        self,
        name: str,
        args: dict,
        results: list[ProductListing],
        seen_result_ids: set[str],
        cart: dict[str, AgentCartItem],
    ) -> tuple[dict, object | None]:
        """Execute one tool; mutate UI state; return (model-visible output, checkout)."""
        s = self._settings

        if name == "search_products":
            query = (args.get("query") or "").strip()
            if not query:
                return {"error": "query is required"}, None
            # Hub-spoke fan-out: the aggregator queries every source in parallel.
            filters = SearchFilters(
                min_price=args.get("min_price"), max_price=args.get("max_price")
            )
            agg = await aggregator_agent.search(query, s.sf_results_per_source, filters)
            self._absorb(agg.listings, results, seen_result_ids)
            return {
                "count": len(agg.listings),
                "sources": [
                    {"source": r.source, "status": r.status, "count": len(r.listings)}
                    for r in agg.sources
                ],
                "products": [_compact(p) for p in agg.listings],
            }, None

        if name == "get_purchase_history":
            days = int(args.get("days") or 30)
            records = await salesforce_client.get_recent_products(days=days)
            records = records[: s.agent_history_limit]  # guardrail: cap result size
            history = [_compact(_normalize(r)) for r in records]
            return {"days": days, "count": len(history), "items": history}, None

        if name == "refresh_products":
            source = args.get("source", "")
            try:
                await trigger_refresh(source)
            except ValueError as exc:
                return {"error": str(exc)}, None
            label = SOURCE_LABELS.get(source, source)
            return {"status": "triggered", "message": f"{label} refresh started."}, None

        if name == "add_to_cart":
            added = []
            for item in args.get("items") or []:
                title = (item.get("title") or "").strip()
                if not title:
                    continue
                source = item.get("source") or ""
                key = f"{source}:{title}".lower()
                cart[key] = AgentCartItem(id=key, name=title, source=source or None)
                added.append(title)
            return {"added": added, "cart_size": len(cart)}, None

        if name == "checkout":
            if not args.get("confirmed"):
                return {
                    "status": "confirmation_required",
                    "message": "Do not check out until the user explicitly confirms.",
                }, None
            if not cart:
                return {"status": "empty", "message": "Cart is empty."}, None
            result = await submit_cart([c.name for c in cart.values()])
            cart.clear()
            return {"status": "ordered", "detail": result.detail}, result

        return {"error": f"unknown tool {name}"}, None

    @staticmethod
    def _absorb(
        listings: list[ProductListing],
        results: list[ProductListing],
        seen: set[str],
    ) -> None:
        """Append new listings to the UI table, de-duplicating by id."""
        for p in listings:
            if p.id not in seen:
                seen.add(p.id)
                results.append(p)

    async def _call_llm(self, convo: list[dict], allow_tools: bool = True) -> dict:
        """Call the chat model, trying DeepSeek first then falling back to
        OpenRouter. Both are OpenAI-compatible, so the same payload works for
        either. ``max_tokens`` caps output per call (token guardrail)."""
        s = self._settings
        payload: dict = {"messages": convo, "max_tokens": s.agent_max_output_tokens}
        if allow_tools:
            payload["tools"] = _TOOLS
            payload["tool_choice"] = "auto"

        # DeepSeek drives the agentic loop; OpenRouter is the per-call fallback.
        providers = [
            ("deepseek", s.deepseek_base_url, s.deepseek_api_key, s.deepseek_model),
            ("openrouter", _OPENROUTER_URL, s.openrouter_api_key, s.openrouter_model),
        ]
        last_exc: Exception | None = None
        for name, url, key, model in providers:
            if not key:
                continue
            try:
                return await self._post(name, url, key, model, payload)
            except Exception as exc:
                logger.warning("Chat provider %s failed (%s) — trying fallback", name, exc)
                last_exc = exc

        if last_exc is not None:
            raise last_exc
        raise RuntimeError(
            "No chat provider configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY)."
        )

    async def _post(
        self, name: str, url: str, key: str, model: str, payload: dict
    ) -> dict:
        body = {**payload, "model": model}
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        if name == "openrouter":  # OpenRouter-specific ranking headers
            headers["HTTP-Referer"] = "http://localhost:5173"
            headers["X-Title"] = "Price Compare"

        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers=headers, timeout=90.0)

        if resp.status_code >= 400:
            logger.error("%s error: HTTP %s — %s", name, resp.status_code, resp.text[:200])
            resp.raise_for_status()
        return resp.json()


shopping_agent = ShoppingAgent()
