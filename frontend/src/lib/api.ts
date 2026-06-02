import type {
  ChatRequest,
  ChatResponse,
  ProductQuery,
  ProductSearchResponse,
  RecommendationRequest,
  RecommendationResponse,
} from "./types";

const BASE = "/api";

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
  chat: (req: ChatRequest): Promise<ChatResponse> => post("/chat", req),
  searchProducts: (query: ProductQuery): Promise<ProductSearchResponse> =>
    post("/products/search", query),
  getRecommendations: (
    req: RecommendationRequest,
  ): Promise<RecommendationResponse> => post("/recommendations/next-purchase", req),
};
