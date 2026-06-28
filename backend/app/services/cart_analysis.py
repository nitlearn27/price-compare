"""Restock analysis — the DeepSeek-backed gate that decides whether a staple the
user has run low on should actually be added to the cart.

The image-identify flow first removes anything bought within the freshness window
(a cheap, certain check). Whatever survives is genuinely ambiguous — "you buy
coriander often and it's not in the photo, but should we re-order it?" — so we ask
the model to reason about perishability vs. days-since-purchase and return a clear
add/skip decision per item. DeepSeek drives this; OpenRouter is the per-call
fallback (both are OpenAI-compatible, so the same payload works for either).
"""

import json
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_SYSTEM_PROMPT = (
    "You are a grocery restock advisor for an Indian household. The user "
    "photographed their fridge/pantry. The items below are staples they buy "
    "regularly that are NOT visible in the photo and were last bought a while "
    "ago. For EACH item decide whether to add it to the cart NOW.\n"
    "Reason about likely remaining stock: weigh days-since-last-order against how "
    "perishable the item is and how often the user buys it. Perishable produce "
    "(coriander, spinach, tomato, milk) spoils in days; staples (rice, oil, "
    "lentils) last weeks. Do NOT re-order something the user most likely still "
    "has. Keep each reason to one short sentence.\n"
    'Respond ONLY with JSON: {"decisions":[{"name":<string>,"add":<bool>,'
    '"reason":<string>}]}'
)


@dataclass
class CartDecision:
    name: str
    add: bool
    reason: str


async def analyze_restock_candidates(candidates: list[dict]) -> dict[str, CartDecision]:
    """Decide which run-low staples genuinely need restocking.

    ``candidates`` items carry ``name``, ``times`` (times purchased) and
    ``days_since`` (days since last order). Returns a ``name.lower()`` → decision
    map. On any provider/parse failure it returns an EMPTY map, so the caller adds
    nothing — the user asked that items be added only after a successful analysis.
    """
    if not candidates:
        return {}

    lines = "\n".join(
        f"- {c['name']}: bought {c['times']}x, last ordered {c['days_since']} days ago"
        for c in candidates
    )
    payload = {
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Items to evaluate:\n{lines}"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 800,
        "temperature": 0,
    }

    s = get_settings()
    providers = [
        ("deepseek", s.deepseek_base_url, s.deepseek_api_key, s.deepseek_model),
        ("openrouter", _OPENROUTER_URL, s.openrouter_api_key, s.openrouter_model),
    ]
    for name, url, key, model in providers:
        if not key:
            continue
        try:
            data = await _post(name, url, key, model, payload)
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            decisions: dict[str, CartDecision] = {}
            for d in parsed.get("decisions", []):
                dec = CartDecision(
                    name=str(d.get("name", "")),
                    add=bool(d.get("add")),
                    reason=str(d.get("reason", "")).strip(),
                )
                if dec.name:
                    decisions[dec.name.lower().strip()] = dec
            return decisions
        except Exception as exc:
            logger.warning("Restock analysis via %s failed (%s) — trying fallback", name, exc)

    logger.error("All providers failed for restock analysis — adding nothing")
    return {}


async def _post(name: str, url: str, key: str, model: str, payload: dict) -> dict:
    body = {**payload, "model": model}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if name == "openrouter":  # OpenRouter-specific ranking headers
        headers["HTTP-Referer"] = "http://localhost:5173"
        headers["X-Title"] = "Price Compare"

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=body, headers=headers, timeout=60.0)

    if resp.status_code >= 400:
        logger.error("%s error: HTTP %s — %s", name, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return resp.json()
