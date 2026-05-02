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


class ProductListing(BaseModel):
    id: str
    title: str
    source: str
    current_price: float | None = None
    original_price: float | None = None
    discount: int | None = None
    rating: str | None = None
    review_count: int | None = None
    rank: int | None = None
    product_url: str | None = None
    image_url: str | None = None
    availability: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)


class ChatResponse(BaseModel):
    reply: str
    product_query: ProductQuery | None = None


class ProductSearchResponse(BaseModel):
    results: list[ProductListing]
