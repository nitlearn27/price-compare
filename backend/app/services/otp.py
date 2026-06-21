"""OTP submission trigger.

When the user types an `otp <number>` message in the chat, we POST the extracted
code to the configured OTP endpoint. This is a deterministic keyword trigger — it
runs before (and instead of) the LLM, so the model never sees or invents OTPs.
"""

import re

import httpx

from app.core import config
from app.core.logging import get_logger

logger = get_logger(__name__)

# Matches the "otp" keyword (word-bounded, case-insensitive) followed by the
# first run of digits anywhere after it, e.g. "otp 600939", "OTP: 600939".
_OTP_PATTERN = re.compile(r"\botp\b\D*(\d+)", re.IGNORECASE)


def extract_otp(text: str) -> str | None:
    """Return the OTP code if the message contains the `otp` keyword + a number."""
    match = _OTP_PATTERN.search(text)
    return match.group(1) if match else None


async def submit_otp(otp: str) -> None:
    """POST the OTP code to the configured endpoint.

    Raises ValueError if the endpoint is not configured, and httpx errors if the
    request fails — callers translate these into user-facing messages.
    """
    url = config.get_settings().otp_api_url
    if not url:
        raise ValueError("No OTP endpoint is configured.")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json={"otp": otp}, timeout=15.0)

    if resp.status_code >= 400:
        logger.error("OTP submission failed: HTTP %s", resp.status_code)
        resp.raise_for_status()

    logger.info("Submitted OTP (HTTP %s)", resp.status_code)
