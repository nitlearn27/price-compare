import type { AggregatorAgent } from "../agents/aggregator";
import type { SearchFilters } from "../agents/base";
import type { Settings } from "../lib/config";
import { normalize } from "../lib/product_search";
import { triggerRefresh, SOURCE_LABELS } from "../lib/refresh";
import { submitCart } from "../lib/cart";
import type { SalesforceClient } from "../lib/salesforce";
import type {
  AgentCartItem,
  CartCheckoutResponse,
  ChatMessage,
  PendingLive,
  ProductListing,
} from "../models/schemas";

export interface ToolContext {
  settings: Settings;
  sf: SalesforceClient;
  aggregator: AggregatorAgent;
}

// A tool signature may execute at most this many times per run.
export const MAX_IDENTICAL_CALLS = 2;

export const SYSTEM_PROMPT =
  "You are an autonomous shopping agent for an Indian grocery & product app. " +
  "Your job is to help the user find the BEST-VALUE products and place orders.\n\n" +
  "You work in a loop: call a tool, look at the REAL data it returns, reason, then " +
  "act again. Only use values returned by tools — never invent prices, ratings, or " +
  "availability.\n\n" +
  "RESPONSE FORMAT RULE (CRITICAL):\n" +
  "When returning search results, always present the response in two sleek sections:\n" +
  "1. A clean markdown comparison table of the top matches (columns: Store | Product | " +
  "Price | Rating).\n" +
  "2. 2-3 brief bullet points (pointers) highlighting the best deal/recommendation based on " +
  "price, rating, or history. Do NOT write paragraphs or long sentences. Keep the entire " +
  "reply professional, sleek, and highly catchy.\n\n" +
  "FINDING A PRODUCT:\n" +
  "1. Call `search_products` with only the core keywords (strip filler like 'give me', " +
  "'price of', 'best', 'cheap'). This searches ALL sources at once (Salesforce catalog + " +
  "live Flipkart + Amazon) and returns merged results plus a per-source status. ALWAYS call " +
  "`search_products` for a product or price query — even if you already searched the same or a " +
  "similar item earlier in this conversation. Prices, availability, and live-store rows change, " +
  "and the on-screen comparison grid is refreshed ONLY from a fresh search. Never answer a " +
  "product/price query from earlier results without searching again.\n" +
  "2. If the user asks to search the product through any specific source (either 'Amazon Now' " +
  "or 'Amazon Fresh' or 'Flipkart Minutes'), it should definitely go to Salesforce to get " +
  "that specific product. However, it should also call the live websites (Amazon or " +
  "Flipkart Minutes) to check if those products are available and if any other similar " +
  "products are available on the live websites.\n" +
  "3. Read the results. Do NOT call `refresh_products` automatically on search unless the user " +
  "explicitly asks to refresh/sync their store. The `sources` field tells you which sources " +
  "responded. The `live_pending` field lists sources still being fetched live — their rows " +
  "appear in the table shortly, so mention they're on the way rather than saying " +
  "nothing was found.\n" +
  "4. Recommend the BEST option. Weigh current_price (lower is better), rating, " +
  "discount, and the user's own history (times_purchased, buy_suggestion — 'restock' " +
  "and 'frequent' items are ones they rely on). State your pick in 1-2 lines citing the " +
  "real numbers (e.g. 'Flipkart ₹249, 4.5★, you've bought this 5×').\n\n" +
  "RESTOCK / 'what do I need':\n" +
  "Call `get_purchase_history` to see what the user buys regularly, find the best deal " +
  "for each item that needs restocking, then propose a combined cart.\n\n" +
  "ORDERING — STRICT MONEY RULE:\n" +
  "- Use `add_to_cart` freely (it is reversible).\n" +
  "- NEVER call `checkout` until the user has EXPLICITLY confirmed in their LATEST " +
  "message ('yes', 'order it', 'place the order'). First PROPOSE the cart: list each " +
  "item, its price, and the total, then ASK the user to confirm — on that turn call NO " +
  "tool, just ask. Only after they confirm, call `checkout`.\n" +
  "- After checkout, tell the user an OTP may be sent to their phone and to paste it here.\n\n" +
  "Reply conversationally (no tool) for greetings/thanks and when asking for confirmation.";

const PRODUCT_TOOL_PROPS = {
  query: {
    type: "string",
    description: "Core product keywords, e.g. 'iPhone 15 Pro 256GB' or 'atta 5kg'.",
  },
  max_price: { type: "number", description: "Maximum price in INR." },
  min_price: { type: "number", description: "Minimum price in INR." },
};

export const TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search ALL sources at once (Salesforce catalog + live Flipkart + Amazon) via the " +
        "aggregator. Returns merged top matches with price, rating, and the user's purchase " +
        "history, plus a per-source status.",
      parameters: { type: "object", required: ["query"], properties: PRODUCT_TOOL_PROPS },
    },
  },
  {
    type: "function",
    function: {
      name: "get_purchase_history",
      description:
        "List the products the user has ordered recently, with how many times they bought " +
        "each and when. Use this for restock recommendations.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Look-back window in days (default 30)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_products",
      description:
        "Trigger a sync of a store's purchase history and catalog into Salesforce. ONLY call " +
        "this when the user explicitly requests to refresh, update, or sync a store.",
      parameters: {
        type: "object",
        required: ["source"],
        properties: { source: { type: "string", enum: ["amazon", "flipkart"] } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Add one or more chosen products to the shopping cart. Reversible.",
      parameters: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "source"],
              properties: { title: { type: "string" }, source: { type: "string" } },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkout",
      description:
        "Place the order for everything currently in the cart. ONLY call this after the user " +
        "has explicitly confirmed they want to order.",
      parameters: {
        type: "object",
        required: ["confirmed"],
        properties: {
          confirmed: {
            type: "boolean",
            description:
              "Must be true, and only set it once the user has explicitly confirmed in their " +
              "latest message.",
          },
        },
      },
    },
  },
];

// Human-readable status shown in the UI (via SSE) when a tool is about to run.
export const TOOL_STATUS: Record<string, string> = {
  search_products: "Searching the catalog…",
  get_purchase_history: "Checking your purchase history…",
  refresh_products: "Syncing your store…",
  add_to_cart: "Updating your cart…",
  checkout: "Placing your order…",
};

/** Trim a listing to the fields the model needs, to conserve context. */
function compact(p: ProductListing): Record<string, unknown> {
  return {
    title: p.title,
    source: p.source,
    origin: p.origin,
    weight: p.weight,
    current_price: p.current_price,
    original_price: p.original_price,
    discount: p.discount,
    rating: p.rating,
    times_purchased: p.times_purchased,
    last_ordered_date: p.last_ordered_date,
    buy_suggestion: p.buy_suggestion,
  };
}

/** Append new listings to the UI table, de-duplicating by id. */
export function absorb(listings: ProductListing[], results: ProductListing[], seen: Set<string>): void {
  for (const p of listings) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      results.push(p);
    }
  }
}

export interface DispatchResult {
  output: Record<string, unknown>;
  checkout: CartCheckoutResponse | null;
  pending: PendingLive | null;
}

/** Execute one tool; mutate `results`/`cart`; return (output, checkout, pending_live). */
export async function dispatch(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
  results: ProductListing[],
  seen: Set<string>,
  cart: Record<string, AgentCartItem>,
  userMsgs: ChatMessage[],
): Promise<DispatchResult> {
  const s = ctx.settings;

  if (name === "search_products") {
    const query = String(args.query ?? "").trim();
    if (!query) return { output: { error: "query is required" }, checkout: null, pending: null };

    const filters: SearchFilters = {
      min_price: (args.min_price as number) ?? null,
      max_price: (args.max_price as number) ?? null,
    };

    let userMsg = "";
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      if (userMsgs[i].role === "user") {
        userMsg = userMsgs[i].content.toLowerCase();
        break;
      }
    }
    const qLower = query.toLowerCase();
    const forceLiveSources: string[] = [];
    const hasAmazon =
      userMsg.includes("amazon now") ||
      userMsg.includes("amazon fresh") ||
      qLower.includes("amazon now") ||
      qLower.includes("amazon fresh");
    if (hasAmazon) forceLiveSources.push("amazon");
    if (userMsg.includes("flipkart minutes") || qLower.includes("flipkart minutes")) {
      forceLiveSources.push("flipkart");
    }

    const { catalog, uncovered } = await ctx.aggregator.searchCatalog(
      query,
      s.sfResultsPerSource,
      filters,
      forceLiveSources,
    );
    absorb(catalog.listings, results, seen);
    const pending: PendingLive | null = uncovered.length
      ? {
          query,
          sources: uncovered,
          min_price: (args.min_price as number) ?? null,
          max_price: (args.max_price as number) ?? null,
        }
      : null;

    return {
      output: {
        count: catalog.listings.length,
        sources: catalog.sources.map((r) => ({
          source: r.source,
          status: r.status,
          count: r.listings.length,
        })),
        products: catalog.listings.map(compact),
        live_pending: uncovered,
      },
      checkout: null,
      pending,
    };
  }

  if (name === "get_purchase_history") {
    const days = Number(args.days ?? 30) || 30;
    const records = (await ctx.sf.getRecentProducts(days)).slice(0, s.agentHistoryLimit);
    const items = records.map((r) => compact(normalize(r)));
    return { output: { days, count: items.length, items }, checkout: null, pending: null };
  }

  if (name === "refresh_products") {
    const source = String(args.source ?? "");
    try {
      await triggerRefresh(s, source);
    } catch (e) {
      return { output: { error: e instanceof Error ? e.message : String(e) }, checkout: null, pending: null };
    }
    const label = SOURCE_LABELS[source] ?? source;
    return { output: { status: "triggered", message: `${label} refresh started.` }, checkout: null, pending: null };
  }

  if (name === "add_to_cart") {
    const added: string[] = [];
    const items = (args.items as Array<{ title?: string; source?: string }>) ?? [];
    for (const item of items) {
      const title = (item.title ?? "").trim();
      if (!title) continue;
      const source = item.source ?? "";
      const key = `${source}:${title}`.toLowerCase();
      cart[key] = { id: key, name: title, source: source || null };
      added.push(title);
    }
    return { output: { added, cart_size: Object.keys(cart).length }, checkout: null, pending: null };
  }

  if (name === "checkout") {
    if (!args.confirmed) {
      return {
        output: {
          status: "confirmation_required",
          message: "Do not check out until the user explicitly confirms.",
        },
        checkout: null,
        pending: null,
      };
    }
    if (Object.keys(cart).length === 0) {
      return { output: { status: "empty", message: "Cart is empty." }, checkout: null, pending: null };
    }
    const items = Object.values(cart).map((c) => ({ name: c.name, source: c.source ?? null }));
    const result = await submitCart(s, ctx.sf, items);
    for (const k of Object.keys(cart)) delete cart[k];
    return { output: { status: "ordered", detail: result.detail }, checkout: result, pending: null };
  }

  return { output: { error: `unknown tool ${name}` }, checkout: null, pending: null };
}
