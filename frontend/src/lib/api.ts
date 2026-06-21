import type {
  CartCheckoutRequest,
  CartCheckoutResponse,
  ChatRequest,
  ChatResponse,
  OtpResponse,
  ProductQuery,
  ProductSearchResponse,
  RecommendationRequest,
  RecommendationResponse,
  RefreshResponse,
  RefreshSource,
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
  searchProductsFlipkart: (query: ProductQuery): Promise<ProductSearchResponse> =>
    post("/products/search/flipkart", query),
  getRecommendations: (
    req: RecommendationRequest,
  ): Promise<RecommendationResponse> => post("/recommendations/next-purchase", req),
  checkoutCart: (req: CartCheckoutRequest): Promise<CartCheckoutResponse> =>
    post("/cart/checkout", req),
  refreshOrders: (source: RefreshSource): Promise<RefreshResponse> =>
    post("/products/refresh", { source }),
  submitOtp: (otp: string): Promise<OtpResponse> => post("/otp", { otp }),
};
