import json

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


PROMPT = """You are an image-analysis assistant.
Identify every distinct object visible in this image.
The scene may be cluttered or the inside of a refrigerator: look carefully inside
drawers, on shelves, behind glass, in jars or bags, and at partially hidden or
occluded items.
For each distinct object:
- give its common name (e.g. "milk jug", "ketchup bottle", "broccoli", "egg carton"),
- give a confidence of "high", "medium", or "low".
Only include objects you actually see. Do not guess at things that are not visible.
Write a one-sentence summary of what the image contains."""

PROMPT_JSON_FALLBACK = (
    PROMPT + "\n\n"
    "CRITICAL: You MUST respond with a valid JSON object matching this schema:\n"
    "{\n"
    "  \"items\": [\n"
    "    {\n"
    "      \"name\": \"string\",\n"
    "      \"confidence\": \"high\" | \"medium\" | \"low\"\n"
    "    }\n"
    "  ],\n"
    "  \"summary\": \"string\"\n"
    "}"
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
                },
                "required": ["name", "confidence"]
            }
        },
        "summary": {"type": "string"}
    },
    "required": ["items", "summary"]
}


async def identify_products_via_gemini(image_base64: str, mime_type: str) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY is not set in the configuration.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": image_base64}},
                    {"text": PROMPT}
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA
        }
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, timeout=60.0)

    if resp.status_code != 200:
        logger.error("Gemini API error: Status %s, Response: %s", resp.status_code, resp.text)
        resp.raise_for_status()

    result = resp.json()
    try:
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.exception("Failed to parse Gemini API response")
        raise ValueError("Invalid response format from Gemini API.") from exc


async def identify_products_via_openrouter_free(image_base64: str, mime_type: str) -> dict:
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not set in the configuration.")

    url = "https://openrouter.ai/api/v1/chat/completions"
    data_url = f"data:{mime_type};base64,{image_base64}"

    payload = {
        "model": settings.openrouter_fallback_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT_JSON_FALLBACK},
                    {"type": "image_url", "image_url": {"url": data_url}}
                ]
            }
        ],
        "response_format": {
            "type": "json_object"
        }
    }

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Price Compare",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=headers, timeout=60.0)

    if resp.status_code != 200:
        logger.error(
            "OpenRouter free vision fallback error: Status %s, Response: %s",
            resp.status_code,
            resp.text,
        )
        resp.raise_for_status()

    result = resp.json()
    try:
        text = result["choices"][0]["message"]["content"]
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.exception("Failed to parse OpenRouter free vision fallback response")
        raise ValueError("Invalid response format from OpenRouter fallback.") from exc


async def identify_products_in_image(image_base64: str, mime_type: str) -> dict:
    try:
        logger.info("Attempting product identification via direct Gemini API...")
        return await identify_products_via_gemini(image_base64, mime_type)
    except Exception as gemini_exc:
        logger.warning(
            "Gemini API failed (%s). Trying with fallback OpenRouter API...",
            gemini_exc
        )
        try:
            return await identify_products_via_openrouter_free(image_base64, mime_type)
        except Exception as openrouter_exc:
            logger.error("OpenRouter free vision fallback also failed: %s", openrouter_exc)
            # Raise the original Gemini exception to report the main failure cleanly
            raise gemini_exc
