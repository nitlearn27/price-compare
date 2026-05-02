from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.models.schemas import ChatRequest, ChatResponse
from app.services.openrouter import openrouter_client

router = APIRouter(tags=["chat"])
logger = get_logger(__name__)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    try:
        reply, product_query = await openrouter_client.chat(request.messages)
        return ChatResponse(reply=reply, product_query=product_query)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Chat endpoint error")
        raise HTTPException(
            status_code=502, detail="The AI service is currently unavailable. Please try again."
        ) from exc
