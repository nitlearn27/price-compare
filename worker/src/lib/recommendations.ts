import type { RecommendationResponse } from "../models/schemas";
import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";
import type { SalesforceClient } from "./salesforce";

// In-memory TTL cache keyed by normalized user input. Serialized via a promise
// chain so concurrent first-opens don't all hit upstream (mirrors the asyncio.Lock).
const cache = new Map<string, [number, RecommendationResponse]>();
let lock: Promise<void> = Promise.resolve();

async function acquire(): Promise<() => void> {
  let release!: () => void;
  const prev = lock;
  lock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  return release;
}

export async function fetchNextPurchase(
  s: Settings,
  sf: SalesforceClient,
  userInput: string,
  refresh = false,
): Promise<RecommendationResponse> {
  const release = await acquire();
  try {
    const key = userInput.trim().toLowerCase();
    if (!refresh) {
      const cached = cache.get(key);
      if (cached && Date.now() / 1000 - cached[0] < s.recommendationCacheTtlSeconds) {
        return cached[1];
      }
    }

    const resp = await fetchWithTimeout(
      s.recommendationApiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: userInput }),
      },
      60_000,
    );
    if (resp.status >= 400) {
      throw new Error(`Recommendation engine error: HTTP ${resp.status}`);
    }
    const result = (await resp.json()) as RecommendationResponse;

    // Enrich with Salesforce image URLs.
    const names = result.recommendations.map((r) => r.product_name).filter(Boolean);
    if (names.length) {
      const images = await sf.getProductImages(names);
      for (const item of result.recommendations) {
        const k = item.product_name.trim().toLowerCase();
        if (images[k]) item.image_url = images[k];
      }
    }

    cache.set(key, [Date.now() / 1000, result]);
    return result;
  } finally {
    release();
  }
}
