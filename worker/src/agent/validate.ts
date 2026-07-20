import type { Settings } from "../lib/config";
import type { ProductListing } from "../models/schemas";
import { completeOnce } from "./llm";

const SYSTEM =
  "You are a strict product-relevance filter for a shopping app. Given a shopping " +
  "intent and a numbered list of product titles, decide which titles are the SAME " +
  "product the user asked for — matching product TYPE, and BRAND when the intent " +
  "names one. Exclude different product types even from the same brand (e.g. for " +
  "'nandini butter', exclude 'Nandini Curd' and 'Nandini Paneer'). Respond with ONLY " +
  "a compact JSON array of the indices to KEEP, e.g. [0,2,3]. No prose, no code fences.";

/** A system note that pins the model's reply to the validated products, so its
 * prose table matches the results grid. The tool output the model already saw
 * still lists the dropped rows, and `messages` is append-only, so we steer the
 * next turn rather than rewrite history. */
export function relevanceNote(kept: ProductListing[]): string {
  const lines = kept.map((p) => `- ${p.title}${p.source ? ` (${p.source})` : ""}`).join("\n");
  return (
    "Relevance filter applied to the search results immediately above: only these products " +
    "are a genuine match for the user's request. Build your comparison table and recommendation " +
    "from ONLY these, and do not mention any other products from those results:\n" + lines
  );
}

/** Extract the first JSON array of in-range integer indices from an LLM reply. */
function parseIndices(raw: string, n: number): Set<number> | null {
  const m = raw.match(/\[[\s\S]*?\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]) as unknown[];
    if (!Array.isArray(arr)) return null;
    const set = new Set<number>();
    for (const x of arr) {
      const i = typeof x === "number" ? x : Number(x);
      if (Number.isInteger(i) && i >= 0 && i < n) set.add(i);
    }
    return set;
  } catch {
    return null;
  }
}

/** Semantic pass over already-normalized rows: keep only those that genuinely
 * match the shopping intent. Fail-open — on any error, unparseable reply, or an
 * empty keep-set, returns the input unchanged (the deterministic filter already
 * ran upstream, so the table is never blanked by validation). */
export async function validateRelevance(
  s: Settings,
  query: string,
  listings: ProductListing[],
): Promise<ProductListing[]> {
  if (!query || listings.length < 2) return listings;

  const lines = listings
    .map((p, i) => `${i}: ${p.title}${p.weight ? ` (${p.weight})` : ""}`)
    .join("\n");
  const user = `Shopping intent: "${query}"\n\nProducts (index: title):\n${lines}`;

  const raw = await completeOnce(s, SYSTEM, user, 200);
  const keep = parseIndices(raw, listings.length);
  if (!keep || keep.size === 0) return listings;

  const filtered = listings.filter((_, i) => keep.has(i));
  return filtered.length ? filtered : listings;
}
