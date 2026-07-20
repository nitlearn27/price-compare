export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: MessageRole;
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

export type BuySuggestion = "frequent" | "restock" | "recent" | "new";

export type Origin = "catalog" | "live";

export interface ProductListing {
  id: string;
  title: string;
  source: string;
  /** "catalog" (Salesforce) or "live" (fetched directly from the store website). */
  origin?: Origin | null;
  current_price: number | null;
  original_price: number | null;
  last_purchased_price: number | null;
  discount: number | null;
  rating: string | null;
  review_count: number | null;
  rank: number | null;
  product_url: string | null;
  image_url: string | null;
  availability: string | null;
  weight?: string | null;
  last_ordered_date: string | null;
  times_purchased: number | null;
  buy_suggestion: BuySuggestion | null;
  suggestion_reason: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** When set, the server keeps conversation + cart state for this thread across
   * turns; the client then sends only the newest turn. */
  thread_id?: string | null;
}

export interface AgentCartItem {
  id: string;
  name: string;
  source: string | null;
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
  checkout: CartCheckoutResponse | null;
  pending_live?: PendingLive | null;
  thread_id?: string | null;
}

export interface ProductSearchResponse {
  results: ProductListing[];
}

export interface RecommendationRequest {
  user_input: string;
  /** Bypass the server-side cache and re-fetch from the engine. */
  refresh?: boolean;
}

export interface RecommendationItem {
  product_name: string;
  product_url: string | null;
  price: number | null;
  reasoning: string | null;
  rating: string | null;
  highlights: string[];
  image_url?: string | null;
}

export interface RecommendationResponse {
  insight_message: string;
  recommendations: RecommendationItem[];
}

/** A UI message extends ChatMessage with an id for React keys. */
export interface UIMessage extends ChatMessage {
  id: string;
  image?: string; // Base64 data URL
}

export interface IdentifyRequest {
  image: string; // Base64 data (without prefix)
  mime_type: string;
}

export interface MustHaveProduct {
  id: string;
  title: string;
  source: string;
  /** Why the analysis decided to restock this item (shown in the chat reply). */
  reason?: string;
}

export interface IdentifyResponse {
  reply: string;
  results: ProductListing[];
  must_have: MustHaveProduct[];
}

export interface CartItem {
  /** Stable unique identifier (the product listing id) — cart membership is keyed on this. */
  id: string;
  name: string;
  source: string | null;
}

export interface CartItemCheckout {
  name: string;
  source: string | null;
}

export interface CartCheckoutRequest {
  products: (string | CartItemCheckout)[];
}

export interface CartCheckoutResponse {
  submitted: number;
  detail: string;
}

export type RefreshSource = "amazon" | "flipkart";

export interface RefreshRequest {
  source: RefreshSource;
}

export interface RefreshResponse {
  detail: string;
}

export interface OtpRequest {
  otp: string;
}

export interface OtpResponse {
  detail: string;
}
