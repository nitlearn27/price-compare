// Wire types — snake_case field names to keep the exact FE↔BE JSON contract
// (mirrors backend/app/models/schemas.py and frontend/src/lib/types.ts).

export type Role = "user" | "assistant" | "system";
export type BuySuggestion = "frequent" | "restock" | "recent" | "new";
export type Origin = "catalog" | "live";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ProductQuery {
  query: string;
  category?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  brand?: string | null;
  sources?: string[] | null;
}

export interface ProductListing {
  id: string;
  title: string;
  source: string;
  origin?: Origin | null;
  current_price?: number | null;
  original_price?: number | null;
  last_purchased_price?: number | null;
  discount?: number | null;
  rating?: string | null;
  review_count?: number | null;
  rank?: number | null;
  product_url?: string | null;
  image_url?: string | null;
  availability?: string | null;
  weight?: string | null;
  last_ordered_date?: string | null;
  times_purchased?: number | null;
  buy_suggestion?: BuySuggestion | null;
  suggestion_reason?: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
  thread_id?: string | null;
}

export interface ProductSearchResponse {
  results: ProductListing[];
}

export interface RecommendationRequest {
  user_input?: string;
  refresh?: boolean;
}

export interface RecommendationItem {
  product_name: string;
  product_url?: string | null;
  price?: number | null;
  reasoning?: string | null;
  rating?: string | null;
  highlights?: string[];
  image_url?: string | null;
}

export interface RecommendationResponse {
  insight_message: string;
  recommendations: RecommendationItem[];
}

export interface CartItemCheckout {
  name: string;
  source?: string | null;
}

export interface CartCheckoutRequest {
  products: Array<string | CartItemCheckout>;
}

export interface CartCheckoutResponse {
  submitted: number;
  detail: string;
}

export interface AgentCartItem {
  id: string;
  name: string;
  source?: string | null;
}

export interface PendingLive {
  query: string;
  sources: string[];
  min_price?: number | null;
  max_price?: number | null;
}

export interface AgentResponse {
  reply: string;
  results: ProductListing[];
  cart: AgentCartItem[];
  checkout?: CartCheckoutResponse | null;
  pending_live?: PendingLive | null;
  thread_id?: string | null;
}

export interface RefreshRequest {
  source: "amazon" | "flipkart";
}

export interface RefreshResponse {
  detail: string;
}

export interface OtpResponse {
  detail: string;
}

export interface IdentifyRequest {
  image: string; // base64 (no data-URL prefix)
  mime_type?: string;
}

export interface MustHaveProduct {
  id: string;
  title: string;
  source: string;
  reason?: string | null;
}

export interface IdentifyResponse {
  reply: string;
  results: ProductListing[];
  must_have: MustHaveProduct[];
}
