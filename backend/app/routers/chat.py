from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.models.schemas import ChatRequest, ChatResponse
from app.services.openrouter import openrouter_client
from app.services.otp import extract_otp, submit_otp

router = APIRouter(tags=["chat"])
logger = get_logger(__name__)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    # Deterministic "otp <number>" trigger — handled before the LLM so the model
    # never sees or invents OTP codes. Only fires when the keyword is present.
    latest = request.messages[-1]
    if latest.role == "user":
        otp = extract_otp(latest.content)
        if otp:
            try:
                await submit_otp(otp)
            except Exception as exc:
                logger.exception("OTP submission error")
                raise HTTPException(
                    status_code=502,
                    detail="Could not submit the OTP right now. Please try again.",
                ) from exc
            return ChatResponse(
                reply=f"Submitted OTP **{otp}**.", product_query=None
            )

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
