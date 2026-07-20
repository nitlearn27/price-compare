import type { ProductListing } from "../models/schemas";
import type { Settings } from "../lib/config";
import { searchAmazon, searchFlipkart } from "../lib/live_search";
import { filterRelevant, queryTokens, rankAndGroup, relevanceOfTitle } from "../lib/product_search";
import type { SalesforceClient } from "../lib/salesforce";
import { applyFilters, type History, type SearchFilters, type SourceAgent, type SourceResult } from "./base";

const CANDIDATE_POOL = 40;
const W_RATING = 0.4;
const W_PRICE = 0.35;
const W_DISCOUNT = 0.15;
const W_REVIEWS = 0.1;

function ratingNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function minmax(arr: number[]): [number | null, number | null] {
  return arr.length ? [Math.min(...arr), Math.max(...arr)] : [null, null];
}

function norm(value: number | null, lo: number | null, hi: number | null, invert = false): number {
  if (value === null || lo === null || hi === null || hi === lo) return 0;
  const n = (value - lo) / (hi - lo);
  return invert ? 1 - n : n;
}

/** Rank live listings relevance-first, then by a composite value score. Rows the
 * query doesn't match are dropped outright (the live store's fuzzy search returns
 * loosely-related items — e.g. curd/paneer for a butter query). */
export function rankByValue(listings: ProductListing[], limit: number, query = ""): ProductListing[] {
  const filtered = query ? filterRelevant(listings, query) : listings;
  if (filtered.length <= 1) return filtered.slice(0, limit);

  const notNull = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
  const [pLo, pHi] = minmax(filtered.map((p) => p.current_price).filter(notNull));
  const [rLo, rHi] = minmax(filtered.map((p) => ratingNum(p.rating)).filter(notNull));
  const [dLo, dHi] = minmax(filtered.map((p) => p.discount).filter(notNull));
  const [vLo, vHi] = minmax(filtered.map((p) => p.review_count).filter(notNull));

  const tokens = queryTokens(query);
  const relevance = (p: ProductListing): number => relevanceOfTitle(p.title || "", tokens);
  const value = (p: ProductListing): number =>
    W_RATING * norm(ratingNum(p.rating), rLo, rHi) +
    W_PRICE * norm(p.current_price ?? null, pLo, pHi, true) +
    W_DISCOUNT * norm(p.discount ?? null, dLo, dHi) +
    W_REVIEWS * norm(p.review_count ?? null, vLo, vHi);

  return [...filtered]
    .sort((a, b) => relevance(b) - relevance(a) || value(b) - value(a))
    .slice(0, limit);
}

function matchHistory(title: string, history: History): ProductListing | null {
  const key = title.toLowerCase().trim();
  if (!key) return null;
  if (history[key]) return history[key];
  for (const [hkey, listing] of Object.entries(history)) {
    if (key.includes(hkey) || hkey.includes(key)) return listing;
  }
  return null;
}

function enrichWithHistory(listings: ProductListing[], history: History): ProductListing[] {
  if (!history || Object.keys(history).length === 0) return listings;
  for (const p of listings) {
    const match = matchHistory(p.title, history);
    if (match && match.times_purchased) {
      p.times_purchased = match.times_purchased;
      p.last_ordered_date = match.last_ordered_date;
      p.buy_suggestion = match.buy_suggestion;
      p.suggestion_reason = match.suggestion_reason;
    }
  }
  return listings;
}

export class SalesforceSpoke implements SourceAgent {
  name = "salesforce";
  coversSource = null;
  constructor(private sf: SalesforceClient) {}

  async search(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
  ): Promise<SourceResult> {
    const records = await this.sf.searchProducts(query);
    const listings = applyFilters(rankAndGroup(records, query, limit), filters);
    for (const p of listings) p.origin = "catalog";
    return { source: "Salesforce catalog", listings, status: listings.length ? "ok" : "empty" };
  }

  enrich(listings: ProductListing[]): ProductListing[] {
    return listings;
  }
}

export class FlipkartSpoke implements SourceAgent {
  name = "flipkart";
  coversSource = "Flipkart";
  constructor(private settings: Settings) {}

  async search(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
    excludeTitles?: Set<string> | null,
  ): Promise<SourceResult> {
    const candidates = await searchFlipkart(this.settings, query, CANDIDATE_POOL);
    let inRange = applyFilters(candidates, filters);
    if (excludeTitles) inRange = inRange.filter((p) => !excludeTitles.has(p.title.toLowerCase().trim()));
    const best = rankByValue(inRange, limit, query);
    for (const p of best) p.origin = "live";
    return { source: "Flipkart (live)", listings: best, status: best.length ? "ok" : "empty" };
  }

  enrich(listings: ProductListing[], history: History): ProductListing[] {
    return enrichWithHistory(listings, history);
  }
}

export class AmazonSpoke implements SourceAgent {
  name = "amazon";
  coversSource = "Amazon";
  constructor(private settings: Settings) {}

  async search(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
    excludeTitles?: Set<string> | null,
  ): Promise<SourceResult> {
    const candidates = await searchAmazon(this.settings, query, CANDIDATE_POOL);
    let inRange = applyFilters(candidates, filters);
    if (excludeTitles) inRange = inRange.filter((p) => !excludeTitles.has(p.title.toLowerCase().trim()));
    const best = rankByValue(inRange, limit, query);
    for (const p of best) p.origin = "live";
    return { source: "Amazon (live)", listings: best, status: best.length ? "ok" : "empty" };
  }

  enrich(listings: ProductListing[], history: History): ProductListing[] {
    return enrichWithHistory(listings, history);
  }
}
