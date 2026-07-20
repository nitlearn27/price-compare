import type { ProductListing } from "../models/schemas";
import type { Settings } from "../lib/config";
import { TimeoutError, withTimeout } from "../lib/http";
import { ciGet, normalize } from "../lib/product_search";
import type { SalesforceClient } from "../lib/salesforce";
import type { History, SearchFilters, SourceAgent, SourceResult } from "./base";
import { AmazonSpoke, FlipkartSpoke, SalesforceSpoke } from "./spokes";

export interface AggregatedResult {
  listings: ProductListing[];
  sources: SourceResult[];
}

export class AggregatorAgent {
  private primary: SourceAgent[];
  private live: SourceAgent[];

  constructor(
    private settings: Settings,
    private sf: SalesforceClient,
  ) {
    this.primary = [new SalesforceSpoke(sf)];
    this.live = [new FlipkartSpoke(settings), new AmazonSpoke(settings)];
  }

  /** Full tiered search: catalog first, then live for any uncovered source. */
  async search(query: string, limit: number, filters?: SearchFilters | null): Promise<AggregatedResult> {
    const { catalog, uncovered } = await this.searchCatalog(query, limit, filters);
    if (uncovered.length === 0) return catalog;
    const live = await this.searchLive(query, limit, filters, uncovered);
    const sources = [...catalog.sources, ...live.sources];
    return { listings: this.merge(sources), sources };
  }

  /** Phase 1 — the fast catalog (Salesforce) tier. Returns the catalog result plus
   * the live spokes whose source the catalog did NOT cover. */
  async searchCatalog(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
    forceLiveSources?: string[] | null,
  ): Promise<{ catalog: AggregatedResult; uncovered: string[] }> {
    const timeoutMs = this.settings.aggregatorSpokeTimeout * 1000;
    const minCatalog = this.settings.aggregatorMinCatalogResults;

    const primaryResults = await Promise.all(
      this.primary.map((sp) => this.runSpoke(sp, query, limit, timeoutMs, filters)),
    );

    const catalogBySource: Record<string, number> = {};
    for (const r of primaryResults) {
      for (const p of r.listings) {
        const key = (p.source || "").toLowerCase().trim();
        catalogBySource[key] = (catalogBySource[key] ?? 0) + 1;
      }
    }

    // A live spoke is covered when catalog sources START WITH its coversSource —
    // the catalog stores variants like "Amazon Now"/"Amazon Fresh".
    const coveredCount = (covers: string): number => {
      if (!covers) return 0;
      let sum = 0;
      for (const [src, n] of Object.entries(catalogBySource)) {
        if (src.startsWith(covers)) sum += n;
      }
      return sum;
    };

    const forceSet = new Set((forceLiveSources ?? []).map((s) => s.toLowerCase()));
    const uncovered: string[] = [];
    for (const sp of this.live) {
      if (forceSet.has(sp.name.toLowerCase())) uncovered.push(sp.name);
      else if (coveredCount((sp.coversSource ?? "").toLowerCase().trim()) < minCatalog) {
        uncovered.push(sp.name);
      }
    }

    return { catalog: { listings: this.merge(primaryResults), sources: primaryResults }, uncovered };
  }

  /** Phase 2 — the slow live store tier. Runs the named live spokes, enriches with
   * purchase history, and merges. */
  async searchLive(
    query: string,
    limit: number,
    filters?: SearchFilters | null,
    sourceNames?: string[] | null,
  ): Promise<AggregatedResult> {
    const timeoutMs = this.settings.aggregatorSpokeTimeout * 1000;
    const enrich = this.settings.aggregatorEnrichHistory;

    let spokes = this.live;
    if (sourceNames) {
      const wanted = new Set(sourceNames.map((n) => n.toLowerCase()));
      spokes = this.live.filter((sp) => wanted.has(sp.name.toLowerCase()));
    }
    if (spokes.length === 0) return { listings: [], sources: [] };

    // Exclude titles already in the catalog so live rows don't duplicate them.
    const excludeTitles = new Set<string>();
    try {
      const sfRecords = await this.sf.searchProducts(query);
      for (const r of sfRecords) {
        const title = (ciGet(r, "Title__c") ?? ciGet(r, "Name")) as string | undefined;
        if (title) excludeTitles.add(title.toLowerCase().trim());
      }
    } catch {
      // best-effort — an empty exclude list just means some rows may repeat
    }

    // Load history concurrently so enrichment adds no extra wait.
    const historyPromise: Promise<History> = enrich
      ? this.loadHistory(this.settings.aggregatorHistoryDays)
      : Promise.resolve({});
    const liveResults = await Promise.all(
      spokes.map((sp) => this.runSpoke(sp, query, limit, timeoutMs, filters, excludeTitles)),
    );
    const history = await historyPromise;
    spokes.forEach((spoke, i) => {
      liveResults[i].listings = spoke.enrich(liveResults[i].listings, history);
    });

    return { listings: this.merge(liveResults), sources: liveResults };
  }

  private async loadHistory(days: number): Promise<History> {
    let records: Record<string, unknown>[];
    try {
      records = await this.sf.getRecentProducts(days);
    } catch {
      return {};
    }
    const history: History = {};
    for (const record of records) {
      const p = normalize(record);
      const key = p.title.toLowerCase().trim();
      if (!key) continue;
      const prior = history[key];
      if (!prior || (p.times_purchased ?? 0) > (prior.times_purchased ?? 0)) history[key] = p;
    }
    return history;
  }

  private async runSpoke(
    spoke: SourceAgent,
    query: string,
    limit: number,
    timeoutMs: number,
    filters?: SearchFilters | null,
    excludeTitles?: Set<string> | null,
  ): Promise<SourceResult> {
    try {
      return await withTimeout(spoke.search(query, limit, filters, excludeTitles), timeoutMs, spoke.name);
    } catch (e) {
      if (e instanceof TimeoutError) {
        const secs = Math.round(timeoutMs / 1000);
        return { source: spoke.name, listings: [], status: "timeout", detail: `${spoke.name} timed out after ${secs}s` };
      }
      return { source: spoke.name, listings: [], status: "error", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Concatenate all spoke listings, de-duping by (source, title); keep the copy
   * carrying purchase history when a product appears twice. */
  private merge(results: SourceResult[]): ProductListing[] {
    const merged: ProductListing[] = [];
    const seen = new Map<string, number>();
    for (const result of results) {
      for (const p of result.listings) {
        const titleKey = p.title.toLowerCase().trim() || p.id.toLowerCase();
        const key = `${p.source.toLowerCase().trim()} ${titleKey}`;
        const idx = seen.get(key);
        if (idx !== undefined) {
          if (merged[idx].times_purchased == null && p.times_purchased != null) merged[idx] = p;
          continue;
        }
        seen.set(key, merged.length);
        merged.push(p);
      }
    }
    return merged;
  }
}

export function makeAggregator(settings: Settings, sf: SalesforceClient): AggregatorAgent {
  return new AggregatorAgent(settings, sf);
}
