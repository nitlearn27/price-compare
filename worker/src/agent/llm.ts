import type { Settings } from "../lib/config";
import { fetchWithTimeout } from "../lib/http";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LlmResponse {
  choices: { message: LlmMessage }[];
  usage?: { total_tokens?: number };
}

async function postLlm(
  name: string,
  url: string,
  key: string,
  model: string,
  payload: Record<string, unknown>,
): Promise<LlmResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (name === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:5173";
    headers["X-Title"] = "Price Compare";
  }
  const resp = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify({ ...payload, model }) },
    90_000,
  );
  if (resp.status >= 400) {
    throw new Error(`${name} error: HTTP ${resp.status}`);
  }
  return (await resp.json()) as LlmResponse;
}

/** The agent-loop model call: DeepSeek first, OpenRouter fallback (both
 * OpenAI-compatible, so the same payload works). */
export async function callLlm(
  s: Settings,
  convo: LlmMessage[],
  allowTools: boolean,
  tools: unknown[],
): Promise<LlmResponse> {
  const payload: Record<string, unknown> = {
    messages: convo,
    max_tokens: s.agentMaxOutputTokens,
  };
  if (allowTools) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const providers: Array<[string, string, string, string]> = [
    ["deepseek", s.deepseekBaseUrl, s.deepseekApiKey, s.deepseekModel],
    ["openrouter", OPENROUTER_URL, s.openrouterApiKey, s.openrouterModel],
  ];
  let lastErr: unknown = null;
  for (const [name, url, key, model] of providers) {
    if (!key) continue;
    try {
      return await postLlm(name, url, key, model, payload);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error("No chat provider configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY).");
}

/** Generic single-shot DeepSeek completion (no tools). Returns the text content,
 * or "" on any failure — callers MUST treat "" as "no answer" and fall back. */
export async function completeOnce(
  s: Settings,
  system: string,
  user: string,
  maxTokens = 256,
): Promise<string> {
  if (!s.deepseekApiKey) return "";
  const payload = {
    model: s.deepseekModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.0,
    max_tokens: maxTokens,
  };
  try {
    const resp = await fetchWithTimeout(
      s.deepseekBaseUrl,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${s.deepseekApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      15_000,
    );
    if (resp.status === 200) {
      const data = (await resp.json()) as LlmResponse;
      return (data.choices[0].message.content ?? "").trim();
    }
  } catch {
    // swallow — caller falls back
  }
  return "";
}

/** Single-shot DeepSeek call used by cart name resolution — returns only the
 * matched title (or ""), never throws. */
export async function callDeepseek(s: Settings, prompt: string): Promise<string> {
  return completeOnce(
    s,
    "You are a helpful product matching assistant. You return only the matched " +
      "product title, or 'NONE' if no product is a good match. No explanation, no " +
      "markdown formatting.",
    prompt,
  );
}
