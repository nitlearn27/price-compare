import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.models.schemas import AgentResponse, ChatRequest
from app.services.agent import shopping_agent
from app.services.otp import extract_otp, submit_otp

router = APIRouter(tags=["agent"])
logger = get_logger(__name__)


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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
            return AgentResponse(reply=f"Submitted OTP **{otp}**.", thread_id=request.thread_id)

    try:
        return await shopping_agent.run(request.messages, thread_id=request.thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Agent endpoint error")
        raise HTTPException(
            status_code=502, detail="The AI service is currently unavailable. Please try again."
        ) from exc


@router.post("/agent/chat/stream")
async def agent_chat_stream(request: ChatRequest) -> StreamingResponse:
    """Same as /agent/chat but streams progress as Server-Sent Events: `status`
    (a tool is running), `results`/`pending_live` (as a search lands), `reply`
    (final text), `done` (the full AgentResponse), or `error`. A streaming 200
    can't change its status code mid-flight, so failures arrive as an `error`
    event rather than an HTTP error."""
    latest = request.messages[-1]

    # OTP short-circuit — mirrors the non-streaming endpoint (model never sees it).
    if latest.role == "user" and (otp := extract_otp(latest.content)):

        async def otp_stream():
            try:
                await submit_otp(otp)
                resp = AgentResponse(reply=f"Submitted OTP **{otp}**.", thread_id=request.thread_id)
                yield _sse("done", resp.model_dump())
            except Exception:
                logger.exception("OTP submission error")
                yield _sse(
                    "error",
                    {"detail": "Could not submit the OTP right now. Please try again."},
                )

        return StreamingResponse(otp_stream(), media_type="text/event-stream")

    async def event_stream():
        try:
            async for event, data in shopping_agent.run_stream(
                request.messages, thread_id=request.thread_id
            ):
                yield _sse(event, data)
        except Exception:
            logger.exception("Agent stream error")
            yield _sse(
                "error",
                {"detail": "The AI service is currently unavailable. Please try again."},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
