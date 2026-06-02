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

export interface ProductListing {
  id: string;
  title: string;
  source: string;
  current_price: number | null;
  original_price: number | null;
  discount: number | null;
  rating: string | null;
  review_count: number | null;
  rank: number | null;
  product_url: string | null;
  image_url: string | null;
  availability: string | null;
  last_ordered_date: string | null;
  times_purchased: number | null;
  buy_suggestion: BuySuggestion | null;
  suggestion_reason: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  product_query: ProductQuery | null;
}

export interface ProductSearchResponse {
  results: ProductListing[];
}

export interface RecommendationRequest {
  user_input: string;
}

export interface RecommendationItem {
  product_name: string;
  product_url: string | null;
  price: number | null;
  reasoning: string | null;
  rating: string | null;
}

export interface RecommendationResponse {
  insight_message: string;
  recommendations: RecommendationItem[];
}

/** A UI message extends ChatMessage with an id for React keys. */
export interface UIMessage extends ChatMessage {
  id: string;
}
