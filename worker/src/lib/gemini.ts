import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";

export interface IdentifiedItem {
  name: string;
  confidence?: "high" | "medium" | "low";
}
export interface IdentifyResult {
  items: IdentifiedItem[];
  summary?: string;
}

const PROMPT = `You are an image-analysis assistant.
Identify every distinct object visible in this image.
The scene may be cluttered or the inside of a refrigerator: look carefully inside
drawers, on shelves, behind glass, in jars or bags, and at partially hidden or
occluded items.
For each distinct object:
- give its common name (e.g. "milk jug", "ketchup bottle", "broccoli", "egg carton"),
- give a confidence of "high", "medium", or "low".
Only include objects you actually see. Do not guess at things that are not visible.
Write a one-sentence summary of what the image contains.`;

const PROMPT_JSON_FALLBACK =
  PROMPT +
  '\n\nCRITICAL: You MUST respond with a valid JSON object matching this schema:\n' +
  '{\n  "items": [\n    {\n      "name": "string",\n      "confidence": "high" | "medium" | "low"\n    }\n  ],\n  "summary": "string"\n}';

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "confidence"],
      },
    },
    summary: { type: "string" },
  },
  required: ["items", "summary"],
};

async function viaGemini(s: Settings, imageBase64: string, mimeType: string): Promise<IdentifyResult> {
  if (!s.geminiApiKey) throw new Error("GEMINI_API_KEY is not set in the configuration.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent?key=${s.geminiApiKey}`;
  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  };
  const resp = await fetchWithTimeout(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    60_000,
  );
  if (resp.status !== 200) throw new Error(`Gemini API error: HTTP ${resp.status}`);
  const result = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Invalid response format from Gemini API.");
  return JSON.parse(text) as IdentifyResult;
}

async function viaOpenRouter(s: Settings, imageBase64: string, mimeType: string): Promise<IdentifyResult> {
  if (!s.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set in the configuration.");
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const payload = {
    model: s.openrouterFallbackModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT_JSON_FALLBACK },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };
  const resp = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Price Compare",
      },
      body: JSON.stringify(payload),
    },
    60_000,
  );
  if (resp.status !== 200) throw new Error(`OpenRouter vision fallback error: HTTP ${resp.status}`);
  const result = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("Invalid response format from OpenRouter fallback.");
  return JSON.parse(text) as IdentifyResult;
}

/** Identify objects in a photo — Gemini primary, OpenRouter free vision fallback. */
export async function identifyProductsInImage(
  s: Settings,
  imageBase64: string,
  mimeType: string,
): Promise<IdentifyResult> {
  try {
    return await viaGemini(s, imageBase64, mimeType);
  } catch (geminiErr) {
    try {
      return await viaOpenRouter(s, imageBase64, mimeType);
    } catch {
      throw geminiErr; // report the primary failure cleanly
    }
  }
}
