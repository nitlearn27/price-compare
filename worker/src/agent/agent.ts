import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { makeAggregator, type AggregatorAgent } from "../agents/aggregator";
import type { Settings } from "../lib/config";
import { getSalesforceClient, type SalesforceClient } from "../lib/salesforce";
import type {
  AgentCartItem,
  AgentResponse,
  CartCheckoutResponse,
  ChatMessage,
  PendingLive,
  ProductListing,
} from "../models/schemas";
import type { Env } from "../env";
import { callLlm, type LlmMessage } from "./llm";
import { relevanceNote, validateRelevance } from "./validate";
import {
  dispatch,
  MAX_IDENTICAL_CALLS,
  SYSTEM_PROMPT,
  TOOL_STATUS,
  TOOLS,
  type ToolContext,
} from "./tools";

const AgentState = Annotation.Root({
  messages: Annotation<LlmMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  results: Annotation<ProductListing[]>({ reducer: (_, b) => b, default: () => [] }),
  cart: Annotation<Record<string, AgentCartItem>>({ reducer: (_, b) => b, default: () => ({}) }),
  pending_live: Annotation<PendingLive | null>({ reducer: (_, b) => b, default: () => null }),
  checkout: Annotation<CartCheckoutResponse | null>({ reducer: (_, b) => b, default: () => null }),
  total_tokens: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  call_counts: Annotation<Record<string, number>>({ reducer: (_, b) => b, default: () => ({}) }),
  step: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  reply: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  // The most recent search query, set by `tools` and consumed (cleared) by
  // `validate` so the relevance pass runs at most once per search.
  last_query: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
});
type State = typeof AgentState.State;

/** Deterministic JSON with sorted keys — the analogue of json.dumps(sort_keys=True). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function mergeById(existing: ProductListing[], incoming: ProductListing[]): ProductListing[] {
  const out = [...existing];
  const seen = new Set(out.map((p) => p.id));
  for (const p of incoming) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

const toDict = (m: ChatMessage): LlmMessage => ({ role: m.role, content: m.content });

interface PersistedState {
  messages: LlmMessage[];
  cart: Record<string, AgentCartItem>;
}

type CompiledGraph = ReturnType<ReturnType<typeof buildGraph>["compile"]>;

function buildGraph(agent: ShoppingAgent) {
  const agentNode = async (state: State): Promise<Partial<State>> => {
    const data = await callLlm(agent.settings, state.messages, true, TOOLS);
    const msg = data.choices[0].message;
    const tokens = Number(data.usage?.total_tokens ?? 0) || 0;
    const update: Partial<State> = {
      messages: [msg],
      step: state.step + 1,
      total_tokens: state.total_tokens + tokens,
    };
    if (!(msg.tool_calls && msg.tool_calls.length)) update.reply = msg.content ?? "";
    return update;
  };

  const toolsNode = async (state: State): Promise<Partial<State>> => {
    const s = agent.settings;
    const last = state.messages[state.messages.length - 1];
    const toolCalls = last?.tool_calls ?? [];

    const nodeResults: ProductListing[] = [];
    const nodeSeen = new Set<string>();
    const nodeCart = { ...state.cart };
    const nodeCounts = { ...state.call_counts };
    const userMsgs: ChatMessage[] = state.messages
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => ({ role: "user", content: m.content as string }));

    const toolMsgs: LlmMessage[] = [];
    let lastPending: PendingLive | null = null;
    let lastCheckout: CartCheckoutResponse | null = null;
    let lastQuery = "";

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (name === "search_products" && typeof args.query === "string") lastQuery = args.query;

      let output: Record<string, unknown>;
      if (i >= s.agentMaxToolCallsPerStep) {
        output = { error: "skipped: too many tool calls this step" };
      } else {
        const sig = `${name}:${stableStringify(args)}`;
        if ((nodeCounts[sig] ?? 0) >= MAX_IDENTICAL_CALLS) {
          output = { note: "already executed this exact call; do not repeat it" };
        } else {
          nodeCounts[sig] = (nodeCounts[sig] ?? 0) + 1;
          const r = await dispatch(agent.ctx, name, args, nodeResults, nodeSeen, nodeCart, userMsgs);
          output = r.output;
          if (r.checkout !== null) lastCheckout = r.checkout;
          if (r.pending !== null) lastPending = r.pending;
        }
      }
      toolMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(output) });
    }

    const update: Partial<State> = { messages: toolMsgs, cart: nodeCart, call_counts: nodeCounts };
    if (nodeResults.length) update.results = mergeById(state.results, nodeResults);
    if (lastPending !== null) update.pending_live = lastPending;
    if (lastCheckout !== null) update.checkout = lastCheckout;
    if (lastQuery) update.last_query = lastQuery;
    return update;
  };

  // Semantic relevance pass: after the fast (deterministically-filtered) results
  // are already emitted by `tools`, drop rows that don't genuinely match the
  // search intent, then emit the refined set. Gated to ≥2 results (nothing to
  // disambiguate otherwise) and fail-open, so it never blanks or blocks the table.
  const validateNode = async (state: State): Promise<Partial<State>> => {
    if (!agent.settings.agentValidateRelevance || !state.last_query) return { last_query: "" };
    if (state.results.length < 2) return { last_query: "" };
    const filtered = await validateRelevance(agent.settings, state.last_query, state.results);
    const update: Partial<State> = { last_query: "" };
    if (filtered.length !== state.results.length) {
      update.results = filtered;
      // Steer the reply the `agent`/`finalize` node is about to compose so its
      // prose table matches the (now-filtered) grid.
      update.messages = [{ role: "system", content: relevanceNote(filtered) }];
    }
    return update;
  };

  const finalizeNode = async (state: State): Promise<Partial<State>> => {
    const data = await callLlm(agent.settings, state.messages, false, TOOLS);
    const content = data.choices[0].message.content;
    return { reply: content || "I wasn't able to finish that — could you rephrase?" };
  };

  const routeAfterAgent = (state: State): string => {
    const last = state.messages[state.messages.length - 1];
    return last?.tool_calls && last.tool_calls.length ? "tools" : END;
  };

  const routeAfterTools = (state: State): string => {
    const s = agent.settings;
    if (state.step >= s.agentMaxSteps || state.total_tokens >= s.agentTokenBudget) return "finalize";
    return "agent";
  };

  return new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("validate", validateNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, { tools: "tools", [END]: END })
    .addEdge("tools", "validate")
    .addConditionalEdges("validate", routeAfterTools, { agent: "agent", finalize: "finalize" })
    .addEdge("finalize", END);
}

export type StreamEvent = [string, Record<string, unknown>];

/** The TS analogue of the Python ShoppingAgent — the LangGraph state machine plus
 * KV-backed cross-turn persistence (Workers isolates are ephemeral, so state is
 * stored in KV keyed by thread_id rather than an in-process checkpointer). */
export class ShoppingAgent {
  readonly settings: Settings;
  readonly ctx: ToolContext;
  private readonly sf: SalesforceClient;
  private readonly aggregator: AggregatorAgent;
  private graph: CompiledGraph | null = null;

  constructor(
    private readonly env: Env,
    settings: Settings,
  ) {
    this.settings = settings;
    this.sf = getSalesforceClient(settings);
    this.aggregator = makeAggregator(settings, this.sf);
    this.ctx = { settings, sf: this.sf, aggregator: this.aggregator };
  }

  private getGraph(): CompiledGraph {
    if (!this.graph) this.graph = buildGraph(this).compile();
    return this.graph;
  }

  private freshState(messages: ChatMessage[]): Partial<State> {
    return { messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.map(toDict)] };
  }

  private usesKv(threadId: string | null | undefined): threadId is string {
    return !!threadId && this.settings.agentCheckpointer !== "none" && !!this.env.AGENT_STATE;
  }

  private async loadState(threadId: string): Promise<PersistedState | null> {
    const raw = await this.env.AGENT_STATE!.get(`agent:${threadId}`);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  }

  private async saveState(threadId: string, state: PersistedState): Promise<void> {
    await this.env.AGENT_STATE!.put(`agent:${threadId}`, JSON.stringify(state), {
      expirationTtl: 86_400,
    });
  }

  private async buildInit(
    messages: ChatMessage[],
    threadId: string | null | undefined,
  ): Promise<Partial<State>> {
    if (this.usesKv(threadId)) {
      const prior = await this.loadState(threadId);
      if (prior && prior.messages?.length) {
        return { messages: [...prior.messages, ...messages.map(toDict)], cart: prior.cart ?? {} };
      }
    }
    return this.freshState(messages);
  }

  private toResponse(final: Partial<State>, threadId: string | null): AgentResponse {
    return {
      reply: final.reply || "",
      results: final.results || [],
      cart: Object.values(final.cart || {}),
      checkout: final.checkout ?? null,
      pending_live: final.pending_live ?? null,
      thread_id: threadId,
    };
  }

  async run(messages: ChatMessage[], threadId?: string | null): Promise<AgentResponse> {
    const config = { recursionLimit: this.settings.agentMaxSteps * 3 + 5 };
    const init = await this.buildInit(messages, threadId);
    const final = (await this.getGraph().invoke(init, config)) as State;
    if (this.usesKv(threadId)) {
      await this.saveState(threadId, { messages: final.messages, cart: final.cart });
    }
    return this.toResponse(final, threadId ?? null);
  }

  async *runStream(messages: ChatMessage[], threadId?: string | null): AsyncGenerator<StreamEvent> {
    const config = {
      recursionLimit: this.settings.agentMaxSteps * 3 + 5,
      streamMode: ["updates", "values"] as ("updates" | "values")[],
    };
    const init = await this.buildInit(messages, threadId);
    let finalState: Partial<State> = {};

    const stream = await this.getGraph().stream(init, config);
    for await (const chunk of stream) {
      const [mode, payload] = chunk as [string, Record<string, Partial<State>>];
      if (mode === "values") {
        finalState = payload as unknown as Partial<State>;
        continue;
      }
      for (const [node, update] of Object.entries(payload)) {
        if (node === "agent") {
          const msgs = update.messages ?? [];
          const msg = msgs[msgs.length - 1] as LlmMessage | undefined;
          const tcs = msg?.tool_calls ?? [];
          for (const tc of tcs) {
            const label = TOOL_STATUS[tc.function?.name];
            if (label) yield ["status", { message: label }];
          }
          if (!tcs.length && update.reply) yield ["reply", { reply: update.reply }];
        } else if (node === "tools") {
          if (update.results) yield ["results", { results: update.results }];
          if (update.pending_live != null) yield ["pending_live", { pending_live: update.pending_live }];
        } else if (node === "validate") {
          // Refined result set from the semantic pass (only emitted when it changed).
          if (update.results) yield ["results", { results: update.results }];
        } else if (node === "finalize" && update.reply) {
          yield ["reply", { reply: update.reply }];
        }
      }
    }

    if (this.usesKv(threadId) && finalState.messages) {
      await this.saveState(threadId, {
        messages: finalState.messages,
        cart: finalState.cart ?? {},
      });
    }
    yield ["done", this.toResponse(finalState, threadId ?? null) as unknown as Record<string, unknown>];
  }
}
