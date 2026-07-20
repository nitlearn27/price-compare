import type {
  AgentResponse,
  CartCheckoutRequest,
  CartCheckoutResponse,
  ChatRequest,
  IdentifyRequest,
  IdentifyResponse,
  OtpResponse,
  PendingLive,
  ProductListing,
  ProductQuery,
  ProductSearchResponse,
  RecommendationRequest,
  RecommendationResponse,
  RefreshResponse,
  RefreshSource,
} from "./types";

const BASE = "/api";

/** Progressive callbacks for the streaming agent endpoint. */
export interface AgentStreamHandlers {
  onStatus?: (message: string) => void;
  onResults?: (results: ProductListing[]) => void;
  onPendingLive?: (pending: PendingLive) => void;
  onReply?: (reply: string) => void;
}

function parseSse(frame: string): { event: string; data: unknown } {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.length ? JSON.parse(dataLines.join("\n")) : {} };
}

/**
 * POST to the streaming agent endpoint and dispatch Server-Sent Events to the
 * handlers, resolving with the final AgentResponse (the `done` event). Throws on
 * transport failure or an `error` event so the caller can fall back to agentChat.
 */
async function agentChatStream(
  req: ChatRequest,
  handlers: AgentStreamHandlers = {},
): Promise<AgentResponse> {
  const resp = await fetch(`${BASE}/agent/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`;
    try {
      detail = ((await resp.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AgentResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const { event, data } = parseSse(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      if (event === "status") handlers.onStatus?.((data as { message: string }).message);
      else if (event === "results")
        handlers.onResults?.((data as { results: ProductListing[] }).results);
      else if (event === "pending_live")
        handlers.onPendingLive?.((data as { pending_live: PendingLive }).pending_live);
      else if (event === "reply") handlers.onReply?.((data as { reply: string }).reply);
      else if (event === "done") final = data as AgentResponse;
      else if (event === "error")
        throw new Error((data as { detail?: string }).detail ?? "stream error");
    }
  }

  if (!final) throw new Error("Stream ended without a result.");
  return final;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      detail = data.detail ?? detail;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }

  return resp.json() as Promise<T>;
}

export const api = {
  agentChat: (req: ChatRequest): Promise<AgentResponse> => post("/agent/chat", req),
  agentChatStream,
  identifyImage: (req: IdentifyRequest): Promise<IdentifyResponse> => post("/identify", req),
  productsLive: (query: ProductQuery): Promise<ProductSearchResponse> =>
    post("/products/live", query),
  getRecommendations: (
    req: RecommendationRequest,
  ): Promise<RecommendationResponse> => post("/recommendations/next-purchase", req),
  checkoutCart: (req: CartCheckoutRequest): Promise<CartCheckoutResponse> =>
    post("/cart/checkout", req),
  refreshOrders: (source: RefreshSource): Promise<RefreshResponse> =>
    post("/products/refresh", { source }),
  submitOtp: (otp: string): Promise<OtpResponse> => post("/otp", { otp }),
};
