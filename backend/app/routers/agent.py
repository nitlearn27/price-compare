from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.models.schemas import AgentResponse, ChatRequest
from app.services.agent import shopping_agent
from app.services.otp import extract_otp, submit_otp

router = APIRouter(tags=["agent"])
logger = get_logger(__name__)


@router.post("/agent/chat", response_model=AgentResponse)
async def agent_chat(request: ChatRequest) -> AgentResponse:
    # Deterministic "otp <number>" trigger — handled before the agent so the model
    # never sees or invents OTP codes (mirrors the legacy /chat behaviour).
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
            return AgentResponse(reply=f"Submitted OTP **{otp}**.")

    try:
        return await shopping_agent.run(request.messages)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Agent endpoint error")
        raise HTTPException(
            status_code=502, detail="The AI service is currently unavailable. Please try again."
        ) from exc
