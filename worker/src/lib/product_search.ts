import type { BuySuggestion, ProductListing } from "../models/schemas";
import { filterTokens } from "./salesforce";

export type SfRecord = Record<string, unknown>;

const RESTOCK_THRESHOLD_DAYS = 7;
const FREQUENT_THRESHOLD = 3;
const MISSING_RANK_SCORE = -(10 ** 9);

export function safeFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function safeInt(value: unknown): number | null {
  const f = safeFloat(value);
  return f === null ? null : Math.trunc(f);
}

function fmtWeight(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  const text = String(value).trim();
  return text || null;
}

/** Case-insensitive field lookup (Salesforce custom-field casing varies by org). */
export function ciGet(record: SfRecord, key: string): unknown {
  if (key in record) return record[key];
  const target = key.toLowerCase();
  for (const k of Object.keys(record)) {
    if (k.toLowerCase() === target) return record[k];
  }
  return undefined;
}

function utcDateOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function utcToday(): number {
  return utcDateOnly(new Date());
}

/** Parse a Salesforce date (YYYY-MM-DD…) to a UTC-midnight epoch, or null. */
export function parseSfDate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function deriveSuggestion(
  times: number | null,
  lastOrdered: number | null,
  today: number,
): [BuySuggestion | null, string | null] {
  if (times === null || times <= 0) return ["new", "Never ordered before"];

  if (times >= FREQUENT_THRESHOLD) {
    if (lastOrdered !== null) {
      const days = Math.floor((today - lastOrdered) / 86400_000);
      return ["frequent", `Bought ${times}x, last ${days} days ago`];
    }
    return ["frequent", `Bought ${times}x`];
  }

  if (lastOrdered === null) {
    return ["restock", `Bought ${times}x, last order date unknown`];
  }

  const days = Math.floor((today - lastOrdered) / 86400_000);
  if (days >= RESTOCK_THRESHOLD_DAYS) {
    return ["restock", `Bought ${times}x, last ${days} days ago`];
  }
  return ["recent", `Bought ${times}x, last ${days} days ago`];
}

/** Order within a source group: times purchased desc, then vendor rank asc. */
function scoreRecord(record: SfRecord): [number, number] {
  const times = safeInt(ciGet(record, "Number_Of_Times_Purchased__c")) ?? 0;
  const rankValue = safeInt(ciGet(record, "Rank__c"));
  const rankScore = rankValue !== null ? -rankValue : MISSING_RANK_SCORE;
  return [times, rankScore];
}

export function parseRating(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const val = o.value ?? o.shortDisplayString ?? o.displayString;
    return val !== null && val !== undefined ? String(val) : null;
  }
  const valStr = String(value).trim();
  if (valStr.startsWith("{") && valStr.endsWith("}")) {
    try {
      const cleaned = valStr
        .replace(/'/g, '"')
        .replace(/True/g, "true")
        .replace(/False/g, "false")
        .replace(/None/g, "null");
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const val = parsed.value ?? parsed.shortDisplayString ?? parsed.displayString;
      if (val !== null && val !== undefined) return String(val);
    } catch {
      // fall through to the raw string
    }
  }
  return valStr;
}

export function normalize(record: SfRecord, today?: number): ProductListing {
  const currentPrice = safeFloat(ciGet(record, "Current_Price__c"));
  const originalPrice = safeFloat(ciGet(record, "Original_Price__c"));
  const lastPurchasedPrice = safeFloat(ciGet(record, "Last_Purchased_Price__c"));
  let discount = safeInt(ciGet(record, "Discount__c"));

  if (
    discount === null &&
    currentPrice !== null &&
    originalPrice !== null &&
    originalPrice > 0 &&
    originalPrice > currentPrice
  ) {
    discount = Math.round((1 - currentPrice / originalPrice) * 100);
  }

  const timesPurchased = safeInt(ciGet(record, "Number_Of_Times_Purchased__c"));
  const lastOrderedRaw = ciGet(record, "Last_Ordered_Date__c");
  const lastOrderedDate = parseSfDate(lastOrderedRaw);
  const [buySuggestion, suggestionReason] = deriveSuggestion(
    timesPurchased,
    lastOrderedDate,
    today ?? utcDateOnly(new Date()),
  );

  return {
    id: (ciGet(record, "Id") as string) || "",
    title: ((ciGet(record, "Title__c") ?? ciGet(record, "Name")) as string) || "",
    source: (ciGet(record, "Source__c") as string) || "",
    origin: "catalog",
    current_price: currentPrice,
    original_price: originalPrice,
    last_purchased_price: lastPurchasedPrice,
    discount,
    rating: parseRating(ciGet(record, "Rating__c")),
    review_count: safeInt(ciGet(record, "Review_Count__c")),
    rank: safeInt(ciGet(record, "Rank__c")),
    product_url: (ciGet(record, "Product_URL__c") as string) ?? null,
    image_url: (ciGet(record, "Image_URL__c") as string) ?? null,
    availability: (ciGet(record, "Availability__c") as string) ?? null,
    weight: fmtWeight(ciGet(record, "Weight__c")),
    last_ordered_date: lastOrderedRaw ? String(lastOrderedRaw).slice(0, 10) : null,
    times_purchased: timesPurchased,
    buy_suggestion: buySuggestion,
    suggestion_reason: suggestionReason,
  };
}

/** Tokenize a query the same way the SOQL builder does: split on whitespace,
 * drop stopwords, lowercase. Falls back to the raw split if every token is a
 * stopword (so a query of only filler still searches for something). */
export function queryTokens(query: string): string[] {
  let toks = query ? filterTokens(query.split(/\s+/)) : [];
  if (toks.length === 0 && query) toks = query.split(/\s+/);
  return toks.map((t) => t.toLowerCase());
}

/** How many of the query tokens appear (as substrings) in a title. */
export function relevanceOfTitle(title: string, tokens: string[]): number {
  const t = title.toLowerCase();
  return tokens.reduce((n, tok) => (t.includes(tok) ? n + 1 : n), 0);
}

/** Minimum relevance a row must clear to count as on-topic, given the observed
 * relevances of the candidate set. If ANY row matches every token, require a
 * full match — this drops brand-only/type-only partials (e.g. "Nandini Curd"
 * for "nandini butter" once a real "Nandini Butter" is present). Otherwise
 * require ≥1 token; if nothing matches at all, keep everything. */
export function minRelevance(relevances: number[], nTokens: number): number {
  if (nTokens === 0) return 0;
  if (relevances.some((r) => r === nTokens)) return nTokens;
  if (relevances.some((r) => r > 0)) return 1;
  return 0;
}

/** Drop already-normalized listings that aren't relevant to the query, using the
 * same rule as the catalog ranking. Used for live scraper rows, which the store's
 * own fuzzy search otherwise returns loosely related to the query. */
export function filterRelevant(items: ProductListing[], query: string): ProductListing[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || items.length === 0) return items;
  const rels = items.map((p) => relevanceOfTitle(p.title, tokens));
  const min = minRelevance(rels, tokens.length);
  return items.filter((_, i) => rels[i] >= min);
}

/** Score, group by source, keep top `perSource`. Mirrors product_search.rank_and_group:
 * relevance-first (require a full-token match when one exists, else drop
 * zero-relevance rows), then times, then rank. */
export function rankAndGroup(records: SfRecord[], query: string, perSource = 3): ProductListing[] {
  const tokens = queryTokens(query);

  const relevanceOf = (record: SfRecord): number => {
    const title = String((ciGet(record, "Title__c") ?? ciGet(record, "Name")) ?? "");
    return relevanceOfTitle(title, tokens);
  };

  const relevances = records.map(relevanceOf);
  const min = minRelevance(relevances, tokens.length);

  type Scored = { relevance: number; times: number; rankScore: number; record: SfRecord };
  const groups = new Map<string, Scored[]>();
  records.forEach((record, i) => {
    if (relevances[i] < min) return;
    const source = (ciGet(record, "Source__c") as string) || "Unknown";
    const [times, rankScore] = scoreRecord(record);
    const bucket = groups.get(source) ?? [];
    bucket.push({ relevance: relevances[i], times, rankScore, record });
    groups.set(source, bucket);
  });

  const result: ProductListing[] = [];
  for (const items of groups.values()) {
    items.sort((a, b) => b.relevance - a.relevance || b.times - a.times || b.rankScore - a.rankScore);
    for (const item of items.slice(0, perSource)) result.push(normalize(item.record));
  }
  return result;
}
