import type { ProductListing } from "../models/schemas";

export type SpokeStatus = "ok" | "empty" | "error" | "timeout" | "not_implemented";

export interface SourceResult {
  source: string; // display label, e.g. "Salesforce catalog", "Flipkart (live)"
  listings: ProductListing[];
  status: SpokeStatus;
  detail?: string | null;
}

export interface SearchFilters {
  min_price?: number | null;
  max_price?: number | null;
}

export type History = Record<string, ProductListing>;

function active(f?: SearchFilters | null): boolean {
  return !!f && (f.min_price != null || f.max_price != null);
}

function matches(f: SearchFilters | null | undefined, price: number | null | undefined): boolean {
  if (!active(f)) return true;
  if (price == null) return false; // unknown price can't be verified against a bound
  if (f!.min_price != null && price < f!.min_price) return false;
  if (f!.max_price != null && price > f!.max_price) return false;
  return true;
}

export function applyFilters(
  listings: ProductListing[],
  filters?: SearchFilters | null,
): ProductListing[] {
  if (!active(filters)) return listings;
  return listings.filter((p) => matches(filters, p.current_price));
}

/** A spoke: query one source, return normalized listings. Deterministic, no LLM. */
export interface SourceAgent {
  name: string;
  // For a LIVE spoke, the catalog `source__c` it stands in for (prefix-matched by
  // the aggregator). null ⇒ always uncovered (e.g. the catalog spoke itself).
  coversSource: string | null;
  search(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
    excludeTitles?: Set<string> | null,
  ): Promise<SourceResult>;
  enrich(listings: ProductListing[], history: History): ProductListing[];
}
