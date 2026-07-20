import type { ProductListing } from "../models/schemas";
import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";
import { parseRating } from "./product_search";

// Live scraping is slow; broad terms can take well over 30s.
const LIVE_TIMEOUT_MS = 120_000;

type Item = Record<string, unknown>;

function ciGet(item: Item, ...keys: string[]): unknown {
  const lowered: Record<string, unknown> = {};
  for (const k of Object.keys(item)) lowered[k.toLowerCase()] = item[k];
  for (const key of keys) {
    const v = lowered[key.toLowerCase()];
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

function safeFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function safeInt(value: unknown): number | null {
  const f = safeFloat(value);
  return f === null ? null : Math.trunc(f);
}

function computeDiscount(current: number | null, original: number | null): number | null {
  if (current !== null && original !== null && original > 0 && original > current) {
    return Math.round((1 - current / original) * 100);
  }
  return null;
}

function extractItems(data: unknown): Item[] {
  if (Array.isArray(data)) return data as Item[];
  if (data && typeof data === "object") {
    for (const key of ["results", "products", "items"]) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Item[];
    }
  }
  return [];
}

function normalizeFlipkart(item: Item, index: number): ProductListing {
  const currentPrice = safeFloat(ciGet(item, "current_price", "price"));
  const originalPrice = safeFloat(ciGet(item, "original_price", "mrp"));
  let discount = safeInt(ciGet(item, "discount"));
  if (discount === null) discount = computeDiscount(currentPrice, originalPrice);

  const rating = ciGet(item, "rating");
  const productUrl = ciGet(item, "product_url", "url") as string | undefined;
  const weight = ciGet(item, "weight");

  return {
    id: String(productUrl || ciGet(item, "id") || `flipkart-${index}`),
    title: (ciGet(item, "title", "name", "product_name") as string) || "",
    source: "Flipkart",
    origin: "live",
    current_price: currentPrice,
    original_price: originalPrice,
    last_purchased_price: null,
    discount,
    rating: rating !== null && rating !== undefined ? String(rating) : null,
    review_count: safeInt(ciGet(item, "review_count", "reviews")),
    rank: safeInt(ciGet(item, "rank")),
    product_url: productUrl ?? null,
    image_url: (ciGet(item, "image_url", "image") as string) ?? null,
    availability: (ciGet(item, "availability") as string) ?? null,
    weight: weight !== null && weight !== undefined ? String(weight) : null,
    last_ordered_date: null,
    times_purchased: null,
    buy_suggestion: "new",
    suggestion_reason: "Live Flipkart result",
  };
}

function normalizeAmazon(item: Item, index: number): ProductListing {
  const currentPrice = safeFloat(ciGet(item, "current_price", "price"));
  const originalPrice = safeFloat(ciGet(item, "original_price", "mrp"));
  let discount = safeInt(ciGet(item, "discount"));
  if (discount === null) discount = computeDiscount(currentPrice, originalPrice);

  const productUrl = ciGet(item, "product_url", "url") as string | undefined;
  const weight = ciGet(item, "weight");

  return {
    id: String(productUrl || ciGet(item, "id") || `amazon-${index}`),
    title: (ciGet(item, "product_name", "title", "name") as string) || "",
    source: "Amazon",
    origin: "live",
    current_price: currentPrice,
    original_price: originalPrice,
    last_purchased_price: null,
    discount,
    rating: parseRating(ciGet(item, "rating")),
    review_count: safeInt(ciGet(item, "review_count", "reviews")),
    rank: safeInt(ciGet(item, "rank")),
    product_url: productUrl ?? null,
    image_url: (ciGet(item, "image_url", "image") as string) ?? null,
    availability: (ciGet(item, "availability") as string) ?? null,
    weight: weight !== null && weight !== undefined ? String(weight) : null,
    last_ordered_date: null,
    times_purchased: null,
    buy_suggestion: "new",
    suggestion_reason: "Live Amazon result",
  };
}

async function fetchLive(url: string, queryParam: string, query: string): Promise<Item[]> {
  const u = new URL(url);
  u.searchParams.set(queryParam, query);
  const resp = await fetchWithTimeout(u.toString(), { method: "GET" }, LIVE_TIMEOUT_MS);
  if (resp.status >= 400) {
    const body = await resp.text();
    throw new Error(`Live search error: HTTP ${resp.status} — ${body.slice(0, 200)}`);
  }
  return extractItems(await resp.json());
}

export async function searchFlipkart(
  settings: Settings,
  query: string,
  limit: number,
): Promise<ProductListing[]> {
  if (!settings.searchProductFlipkartUrl) return [];
  const items = (await fetchLive(settings.searchProductFlipkartUrl, "name", query)).slice(0, limit);
  return items.map((item, i) => normalizeFlipkart(item, i));
}

export async function searchAmazon(
  settings: Settings,
  query: string,
  limit: number,
): Promise<ProductListing[]> {
  if (!settings.searchProductAmazonUrl) return [];
  const items = (await fetchLive(settings.searchProductAmazonUrl, "q", query)).slice(0, limit);
  return items.map((item, i) => normalizeAmazon(item, i));
}
