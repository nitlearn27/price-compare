import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";

export const SOURCE_LABELS: Record<string, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
};

function urlFor(s: Settings, source: string): string {
  if (source === "amazon") return s.refreshAmazonUrl;
  if (source === "flipkart") return s.refreshFlipkartUrl;
  return "";
}

/** POST to the configured refresh endpoint for `source`. Throws if unconfigured
 * or on HTTP error (callers translate to a user-facing message). */
export async function triggerRefresh(s: Settings, source: string): Promise<void> {
  const url = urlFor(s, source);
  if (!url) {
    throw new Error(`No refresh endpoint is configured for ${SOURCE_LABELS[source] ?? source}.`);
  }
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: s.refreshOrders }),
    },
    15_000,
  );
  if (resp.status >= 400) throw new Error(`Refresh trigger for ${source} failed: HTTP ${resp.status}`);
}
