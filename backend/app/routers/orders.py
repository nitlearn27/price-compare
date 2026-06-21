from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.models.schemas import (
    OtpRequest,
    OtpResponse,
    RefreshRequest,
    RefreshResponse,
)
from app.services.otp import submit_otp
from app.services.refresh import SOURCE_LABELS, trigger_refresh

router = APIRouter(tags=["orders"])
logger = get_logger(__name__)


@router.post("/products/refresh", response_model=RefreshResponse)
async def refresh_orders(req: RefreshRequest) -> RefreshResponse:
    """Trigger a re-scrape of a store's orders into Salesforce (fire-and-forget)."""
    label = SOURCE_LABELS.get(req.source, req.source)
    try:
        await trigger_refresh(req.source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Refresh trigger error for %s", req.source)
        raise HTTPException(
            status_code=502,
            detail=f"Could not start the {label} refresh right now. Please try again.",
        ) from exc

    return RefreshResponse(
        detail=f"Triggered an {label} refresh. Updated data will appear shortly."
    )


@router.post("/otp", response_model=OtpResponse)
async def submit_otp_code(req: OtpRequest) -> OtpResponse:
    """Submit a login OTP code to the external service."""
    try:
        await submit_otp(req.otp)
    except Exception as exc:
        logger.exception("OTP submission error")
        raise HTTPException(
            status_code=502,
            detail="Could not submit the OTP right now. Please try again.",
        ) from exc

    return OtpResponse(detail="Submitted OTP.")
