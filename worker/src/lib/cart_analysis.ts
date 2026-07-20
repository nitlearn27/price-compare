import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT =
  "You are a grocery restock advisor for an Indian household. The user " +
  "photographed their fridge/pantry. The items below are staples they buy " +
  "regularly that are NOT visible in the photo and were last bought a while " +
  "ago. For EACH item decide whether to add it to the cart NOW.\n" +
  "Reason about likely remaining stock: weigh days-since-last-order against how " +
  "perishable the item is and how often the user buys it. Perishable produce " +
  "(coriander, spinach, tomato, milk) spoils in days; staples (rice, oil, " +
  "lentils) last weeks. Do NOT re-order something the user most likely still " +
  "has. Keep each reason to one short sentence.\n" +
  'Respond ONLY with JSON: {"decisions":[{"name":<string>,"add":<bool>,"reason":<string>}]}';

export interface CartDecision {
  name: string;
  add: boolean;
  reason: string;
}

export interface RestockCandidate {
  name: string;
  times: number;
  days_since: number | string;
}

async function post(
  name: string,
  url: string,
  key: string,
  model: string,
  payload: Record<string, unknown>,
): Promise<{ choices: { message: { content: string } }[] }> {
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
    60_000,
  );
  if (resp.status >= 400) throw new Error(`${name} error: HTTP ${resp.status}`);
  return (await resp.json()) as { choices: { message: { content: string } }[] };
}

/** Decide which run-low staples genuinely need restocking. Returns a
 * name.toLowerCase() → decision map; an EMPTY map on any failure (adds nothing). */
export async function analyzeRestockCandidates(
  s: Settings,
  candidates: RestockCandidate[],
): Promise<Record<string, CartDecision>> {
  if (candidates.length === 0) return {};

  const lines = candidates
    .map((c) => `- ${c.name}: bought ${c.times}x, last ordered ${c.days_since} days ago`)
    .join("\n");
  const payload = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Items to evaluate:\n${lines}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 800,
    temperature: 0,
  };

  const providers: Array<[string, string, string, string]> = [
    ["deepseek", s.deepseekBaseUrl, s.deepseekApiKey, s.deepseekModel],
    ["openrouter", OPENROUTER_URL, s.openrouterApiKey, s.openrouterModel],
  ];
  for (const [name, url, key, model] of providers) {
    if (!key) continue;
    try {
      const data = await post(name, url, key, model, payload);
      const parsed = JSON.parse(data.choices[0].message.content) as {
        decisions?: Array<{ name?: string; add?: unknown; reason?: string }>;
      };
      const decisions: Record<string, CartDecision> = {};
      for (const d of parsed.decisions ?? []) {
        const dec: CartDecision = {
          name: String(d.name ?? ""),
          add: Boolean(d.add),
          reason: String(d.reason ?? "").trim(),
        };
        if (dec.name) decisions[dec.name.toLowerCase().trim()] = dec;
      }
      return decisions;
    } catch {
      // try next provider
    }
  }
  return {};
}
