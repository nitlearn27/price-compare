"""LangGraph orchestration for the shopping agent.

This replaces the hand-rolled ``for``-loop in ``ShoppingAgent.run`` with a
``StateGraph`` whose cycle is:

    START → agent ──(no tool_calls)────────────────────────────► END
              │
              └(tool_calls)─► tools ──(under guardrails)─► agent (loop)
                                    └(step/token cap hit)─► finalize → END

The nodes are closures over a ``ShoppingAgent`` instance so they reuse its
``_call_llm`` (raw httpx, DeepSeek→OpenRouter fallback — keeps the respx test
seams), ``_dispatch`` (the tool table, unchanged), and ``_settings`` (read live,
so per-request guardrail overrides in tests still take effect). Messages stay in
plain OpenAI dict form — no LangChain message objects — so ``_call_llm`` is used
verbatim.
"""

from __future__ import annotations

import json
import operator
import os
from typing import TYPE_CHECKING, Annotated, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.core.config import Settings
from app.models.schemas import (
    AgentCartItem,
    CartCheckoutResponse,
    ChatMessage,
    PendingLive,
    ProductListing,
)
from app.services.validate import relevance_note, validate_relevance

if TYPE_CHECKING:
    from app.services.agent import ShoppingAgent


def _merge_results(
    existing: list[ProductListing] | None, new: list[ProductListing] | None
) -> list[ProductListing]:
    """Reducer for the comparison-table channel: append new listings, de-duping
    by id (mirrors ``ShoppingAgent._absorb`` but across the whole run/thread)."""
    out = list(existing or [])
    seen = {p.id for p in out}
    for p in new or []:
        if p.id not in seen:
            seen.add(p.id)
            out.append(p)
    return out


class AgentState(TypedDict):
    # `messages` and `cart` PERSIST across turns (via the checkpointer); every
    # other channel is per-run and reset at the start of each turn. `results` and
    # `total_tokens` therefore use plain overwrite channels (nodes accumulate them
    # explicitly), so a continuing turn can reset them by seeding []/0 — a reducer
    # channel could not be reset from the input.
    messages: Annotated[list[dict], operator.add]  # convo incl. tool results (append)
    results: list[ProductListing]  # comparison table (nodes merge+dedup explicitly)
    cart: dict[str, AgentCartItem]  # overwrite: checkout clears it; persists across turns
    pending_live: PendingLive | None  # overwrite: only the last is owed to the FE
    checkout: CartCheckoutResponse | None  # overwrite
    total_tokens: int  # cumulative usage this run (nodes accumulate); guardrail
    call_counts: dict[str, int]  # identical-call repeat guard
    step: int  # incremented in the agent node
    reply: str  # final user-facing text
    last_query: str  # most recent search query; set by `tools`, consumed by `validate`


def build_graph(
    agent: ShoppingAgent, checkpointer: BaseCheckpointSaver | None = None
):
    """Compile the agent graph, wiring nodes to ``agent``'s methods. Pass a
    ``checkpointer`` to enable cross-turn persistent state (thread-scoped)."""

    async def agent_node(state: AgentState) -> dict:
        data = await agent._call_llm(state["messages"], allow_tools=True)
        msg = data["choices"][0]["message"]
        tokens = int((data.get("usage") or {}).get("total_tokens") or 0)
        update: dict = {
            "messages": [msg],
            "step": state["step"] + 1,
            "total_tokens": state.get("total_tokens", 0) + tokens,
        }
        # A message with no tool_calls is the final answer.
        if not (msg.get("tool_calls") or []):
            update["reply"] = msg.get("content") or ""
        return update

    async def tools_node(state: AgentState) -> dict:
        s = agent._settings
        tool_calls = state["messages"][-1].get("tool_calls") or []

        # Local accumulators handed to `_dispatch` (unchanged signature); the
        # results/cart/counts are folded back into graph state via the return.
        node_results: list[ProductListing] = []
        node_seen: set[str] = set()
        node_cart = dict(state.get("cart") or {})
        node_counts = dict(state.get("call_counts") or {})
        # `_dispatch`'s search branch inspects the latest user message (for explicit
        # "Amazon Now"/"Flipkart Minutes" requests). Reconstruct the user turns.
        user_msgs = [
            ChatMessage(role="user", content=m["content"])
            for m in state["messages"]
            if m.get("role") == "user" and isinstance(m.get("content"), str)
        ]

        tool_msgs: list[dict] = []
        last_pending: PendingLive | None = None
        last_checkout: CartCheckoutResponse | None = None
        last_query = ""

        for i, tc in enumerate(tool_calls):
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            if name == "search_products" and isinstance(args.get("query"), str):
                last_query = args["query"]

            # Guardrail: cap tools actually executed per step (still emit a result).
            if i >= s.agent_max_tool_calls_per_step:
                output: dict = {"error": "skipped: too many tool calls this step"}
            else:
                sig = f"{name}:{json.dumps(args, sort_keys=True)}"
                if node_counts.get(sig, 0) >= agent.MAX_IDENTICAL_CALLS:
                    output = {"note": "already executed this exact call; do not repeat it"}
                else:
                    node_counts[sig] = node_counts.get(sig, 0) + 1
                    out, ckout, pending = await agent._dispatch(
                        name, args, node_results, node_seen, node_cart, user_msgs
                    )
                    output = out
                    if ckout is not None:
                        last_checkout = ckout
                    if pending is not None:
                        last_pending = pending

            tool_msgs.append(
                {"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(output)}
            )

        update: dict = {"messages": tool_msgs, "cart": node_cart, "call_counts": node_counts}
        if node_results:
            # Overwrite channel: merge this step's new listings onto the running
            # table (deduped by id) and write the full list back.
            update["results"] = _merge_results(state.get("results") or [], node_results)
        if last_pending is not None:
            update["pending_live"] = last_pending
        if last_checkout is not None:
            update["checkout"] = last_checkout
        if last_query:
            update["last_query"] = last_query
        return update

    async def validate_node(state: AgentState) -> dict:
        # Semantic relevance pass: after `tools` has emitted the fast,
        # deterministically-filtered results, drop rows that don't genuinely match
        # the search intent and emit the refined set. Gated to >=2 results and
        # fail-open, so it never blanks or blocks the table.
        query = state.get("last_query") or ""
        if not agent._settings.agent_validate_relevance or not query:
            return {"last_query": ""}
        results = state.get("results") or []
        if len(results) < 2:
            return {"last_query": ""}
        filtered = await validate_relevance(agent, query, results)
        update: dict = {"last_query": ""}
        if len(filtered) != len(results):
            update["results"] = filtered
            # Steer the reply the agent/finalize node is about to compose so its
            # prose table matches the (now-filtered) grid.
            update["messages"] = [{"role": "system", "content": relevance_note(filtered)}]
        return update

    async def finalize_node(state: AgentState) -> dict:
        # Loop exhausted (step cap or token budget): force a prose answer.
        data = await agent._call_llm(state["messages"], allow_tools=False)
        content = data["choices"][0]["message"].get("content")
        return {"reply": content or "I wasn't able to finish that — could you rephrase?"}

    def route_after_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        return "tools" if (last.get("tool_calls") or []) else END

    def route_after_tools(state: AgentState) -> str:
        s = agent._settings
        if state["step"] >= s.agent_max_steps or state["total_tokens"] >= s.agent_token_budget:
            return "finalize"
        return "agent"

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)
    graph.add_node("validate", validate_node)
    graph.add_node("finalize", finalize_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", route_after_agent, {"tools": "tools", END: END})
    graph.add_edge("tools", "validate")
    graph.add_conditional_edges(
        "validate", route_after_tools, {"agent": "agent", "finalize": "finalize"}
    )
    graph.add_edge("finalize", END)
    return graph.compile(checkpointer=checkpointer)


def make_checkpointer(kind: str) -> BaseCheckpointSaver | None:
    """Select a checkpointer by config. "none" → stateless; "memory" → in-process
    MemorySaver (lost on restart/spin-down — see the caveat in CLAUDE.md)."""
    if kind == "memory":
        return MemorySaver()
    return None


def enable_tracing(s: Settings) -> None:
    """Export LangSmith env vars so LangChain/LangGraph auto-trace the graph.
    LangChain reads os.environ directly, not our Settings object."""
    if not s.langchain_api_key:
        return
    os.environ["LANGCHAIN_API_KEY"] = s.langchain_api_key
    os.environ["LANGSMITH_API_KEY"] = s.langchain_api_key
    os.environ["LANGCHAIN_PROJECT"] = s.langchain_project
    if s.langchain_endpoint:
        os.environ["LANGCHAIN_ENDPOINT"] = s.langchain_endpoint
        os.environ["LANGSMITH_ENDPOINT"] = s.langchain_endpoint
    if s.langchain_tracing_v2:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGSMITH_TRACING"] = "true"
