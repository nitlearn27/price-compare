from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ProductQuery(BaseModel):
    query: str = Field(..., min_length=1)
    category: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    brand: str | None = None
    sources: list[str] | None = None


BuySuggestion = Literal["frequent", "restock", "recent", "new"]


class ProductListing(BaseModel):
    id: str
    title: str
    source: str
    current_price: float | None = None
    original_price: float | None = None
    last_purchased_price: float | None = None
    discount: int | None = None
    rating: str | None = None
    review_count: int | None = None
    rank: int | None = None
    product_url: str | None = None
    image_url: str | None = None
    availability: str | None = None
    last_ordered_date: str | None = None
    times_purchased: int | None = None
    buy_suggestion: BuySuggestion | None = None
    suggestion_reason: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)


class ChatResponse(BaseModel):
    reply: str
    product_query: ProductQuery | None = None


class ProductSearchResponse(BaseModel):
    results: list[ProductListing]


class RecommendationRequest(BaseModel):
    # Optional free-text preference; blank is coerced to the default by the router.
    user_input: str = "Give recommendations"


class RecommendationItem(BaseModel):
    product_name: str
    product_url: str | None = None
    price: float | None = None
    reasoning: str | None = None
    rating: str | None = None
    highlights: list[str] = []


class RecommendationResponse(BaseModel):
    insight_message: str
    recommendations: list[RecommendationItem]


class CartCheckoutRequest(BaseModel):
    products: list[str] = Field(..., min_length=1)


class CartCheckoutResponse(BaseModel):
    submitted: int  # count of products sent
    detail: str  # human-readable confirmation


class RefreshRequest(BaseModel):
    source: Literal["amazon", "flipkart"]


class RefreshResponse(BaseModel):
    detail: str  # human-readable confirmation


class OtpRequest(BaseModel):
    otp: str = Field(..., min_length=1)


class OtpResponse(BaseModel):
    detail: str  # human-readable confirmation
