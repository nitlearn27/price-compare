import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";

/** Escape special chars in a SOQL string literal (order matters). */
export function escapeSoql(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

// Filler words the LLM (or user) may leak into the query — they rarely appear in
// real product titles, so requiring them via AND-LIKE returns zero results.
const STOPWORDS = new Set<string>([
  "a", "an", "the", "any", "some", "all",
  "give", "show", "find", "get", "tell", "list",
  "me", "us", "my", "i", "we",
  "price", "prices", "cost", "rate", "rates",
  "of", "for", "on", "in", "at", "with", "to",
  "best", "cheap", "cheapest", "good", "top", "popular",
  "please", "kindly",
  "is", "are", "available", "availability",
  "and", "or",
  "fresh", "natural", "organic", "pure", "local", "premium", "farm", "healthy",
  "packet", "pouch", "pack", "kg", "g", "gm", "ml", "litre", "ltr",
]);

/** Drop stopwords; keep meaningful product keywords. */
export function filterTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t.toLowerCase()));
}

type SfRecord = Record<string, unknown>;

export class SalesforceClient {
  settings: Settings;
  private accessToken: string | null = null;
  private instanceUrl: string | null = null;
  private expiresAt = 0; // epoch ms
  private refreshing: Promise<void> | null = null;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  private async fetchToken(): Promise<void> {
    const s = this.settings;
    const resp = await fetchWithTimeout(
      s.sfTokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: s.sfClientId,
          client_secret: s.sfClientSecret,
        }),
      },
      30000,
    );
    if (resp.status !== 200) {
      throw new Error(`Salesforce token request failed: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      access_token: string;
      instance_url?: string;
      expires_in?: number;
    };
    this.accessToken = data.access_token;
    this.instanceUrl = data.instance_url || s.sfInstanceUrl;
    const expiresIn = Number(data.expires_in ?? 7200);
    this.expiresAt = Date.now() + (expiresIn - 300) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.expiresAt) return;
    // Single-flight refresh (JS is single-threaded, so this check+set is atomic).
    if (!this.refreshing) {
      this.refreshing = this.fetchToken().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
  }

  private async request(
    method: string,
    url: string,
    retry = true,
  ): Promise<Record<string, unknown>> {
    await this.ensureToken();
    const resp = await fetchWithTimeout(
      url,
      { method, headers: { Authorization: `Bearer ${this.accessToken}` } },
      30000,
    );

    if (resp.status === 401 && retry) {
      this.accessToken = null;
      this.expiresAt = 0;
      return this.request(method, url, false);
    }
    if (resp.status >= 400) {
      const body = await resp.text();
      throw new Error(`Salesforce error: HTTP ${resp.status} body=${body.slice(0, 200)}`);
    }
    return (await resp.json()) as Record<string, unknown>;
  }

  private buildSoql(whereClause: string, limit: number): string {
    return (
      "SELECT Id, Name, title__c, source__c, current_price__c, original_price__c, " +
      "last_purchased_price__c, " +
      "discount__c, rating__c, review_count__c, rank__c, product_url__c, " +
      "image_url__c, availability__c, weight__c, last_ordered_date__c, " +
      "number_of_times_purchased__c " +
      "FROM Grocery_Product__c " +
      `WHERE ${whereClause} AND source__c != null AND source__c != '' ` +
      "ORDER BY source__c ASC, rating__c DESC NULLS LAST, " +
      "review_count__c DESC NULLS LAST " +
      `LIMIT ${limit}`
    );
  }

  private queryUrl(soql: string): string {
    const s = this.settings;
    const base = this.instanceUrl || s.sfInstanceUrl;
    const u = new URL(`${base}/services/data/v${s.sfApiVersion}/query`);
    u.searchParams.set("q", soql);
    return u.toString();
  }

  async searchProducts(query: string, limit?: number): Promise<SfRecord[]> {
    query = query.trim();
    if (!query) throw new Error("Search query must not be empty or whitespace.");
    const s = this.settings;
    const lim = limit ?? s.sfQueryLimit;

    const meaningful = filterTokens(query.split(/\s+/)).slice(0, 5);
    const tokens = meaningful.length ? meaningful : [query];
    const escaped = tokens.map(escapeSoql);

    const andClauses = escaped.map((t) => `title__c LIKE '%${t}%'`).join(" AND ");
    let data = await this.request("GET", this.queryUrl(this.buildSoql(andClauses, lim)));
    let records = (data.records as SfRecord[]) ?? [];

    if (records.length === 0 && escaped.length > 1) {
      const orClauses = escaped.map((t) => `title__c LIKE '%${t}%'`).join(" OR ");
      data = await this.request("GET", this.queryUrl(this.buildSoql(`(${orClauses})`, lim)));
      records = (data.records as SfRecord[]) ?? [];
    }
    return records;
  }

  async getRecentProducts(days = 7, limit?: number): Promise<SfRecord[]> {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const where = `last_ordered_date__c >= ${cutoff}`;
    const lim = limit ?? this.settings.sfQueryLimit;
    const data = await this.request("GET", this.queryUrl(this.buildSoql(where, lim)));
    return (data.records as SfRecord[]) ?? [];
  }

  async getProductImages(productNames: string[]): Promise<Record<string, string>> {
    if (productNames.length === 0) return {};
    const namesIn = productNames.map((n) => `'${escapeSoql(n)}'`).join(", ");
    const where = `title__c IN (${namesIn}) OR Name IN (${namesIn})`;
    const soql = `SELECT title__c, Name, image_url__c FROM Grocery_Product__c WHERE ${where}`;
    try {
      const data = await this.request("GET", this.queryUrl(soql));
      const records = (data.records as SfRecord[]) ?? [];
      const images: Record<string, string> = {};
      for (const r of records) {
        const img = (r.image_url__c ?? r.Image_URL__c) as string | undefined;
        const title = (r.title__c ?? r.Title__c ?? r.Name) as string | undefined;
        if (title && img) images[title.trim().toLowerCase()] = img;
      }
      return images;
    } catch {
      return {};
    }
  }
}

let _client: SalesforceClient | null = null;

/** Module-level singleton so the OAuth token cache survives across requests in a
 * warm isolate (mirrors the Python module singleton). */
export function getSalesforceClient(settings: Settings): SalesforceClient {
  if (!_client) _client = new SalesforceClient(settings);
  else _client.settings = settings;
  return _client;
}
