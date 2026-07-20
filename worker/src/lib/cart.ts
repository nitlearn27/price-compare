import { callDeepseek } from "../agent/llm";
import type { CartCheckoutResponse, CartItemCheckout } from "../models/schemas";
import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";
import type { SalesforceClient } from "./salesforce";

// The upstream cart is asynchronous single-flight: a POST returns 202, and while
// a run is active concurrent POSTs get 409. Runs finish in a few seconds.
const BUSY_RETRY_ATTEMPTS = 3;
const BUSY_RETRY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (r[k] !== null && r[k] !== undefined) return r[k];
  return undefined;
}

async function extractCoreKeyword(s: Settings, productName: string): Promise<string> {
  const prompt =
    "You are a shopping assistant. Extract the single core product keyword/noun " +
    "from this detailed product name.\n" +
    "For example:\n" +
    "- 'Fresh Brinjal Bharta (Bottle Shape)' -> 'brinjal'\n" +
    "- 'Nandini Homogenised Cow Milk' -> 'milk'\n" +
    "- 'Aashirvaad Superior MP Atta 5kg' -> 'atta'\n" +
    "- 'Fresh Onion 1kg' -> 'onion'\n" +
    `Product name: '${productName}'\n` +
    "Reply ONLY with the extracted core product name in lowercase, and nothing else.";

  let val = "";
  try {
    const core = await callDeepseek(s, prompt);
    val = core.trim().toLowerCase().replace(/['".]/g, "");
  } catch {
    val = "";
  }

  if (!val || val === "none") {
    const words = productName
      .split(/\s+/)
      .filter((w) => /^[a-zA-Z]+$/.test(w))
      .map((w) => w.toLowerCase());
    const staples = ["brinjal", "milk", "onion", "atta", "salt", "oil", "sugar", "bread", "butter"];
    for (const word of words) if (staples.includes(word)) return word;
    return words.length ? words[0] : productName;
  }
  return val;
}

async function resolveName(
  s: Settings,
  sf: SalesforceClient,
  originalName: string,
  targetSource: string,
): Promise<string> {
  let records: Record<string, unknown>[];
  try {
    records = await sf.searchProducts(originalName);
  } catch {
    return originalName;
  }

  const purchased: Record<string, unknown>[] = [];
  for (const r of records) {
    const src = pick(r, "Source__c", "source__c") as string | undefined;
    if (!src || src.toLowerCase() !== targetSource.toLowerCase()) continue;
    const times = pick(r, "Number_Of_Times_Purchased__c", "number_of_times_purchased__c");
    const lastOrdered = pick(r, "Last_Ordered_Date__c", "last_ordered_date__c");
    let hasPurchased = false;
    const t = Number(times);
    if (times !== undefined && Number.isFinite(t) && t > 0) hasPurchased = true;
    if (lastOrdered !== undefined && lastOrdered !== null) hasPurchased = true;
    if (hasPurchased) purchased.push(r);
  }
  if (purchased.length === 0) return originalName;

  const unique: string[] = [];
  for (const r of purchased) {
    const title = (pick(r, "title__c", "Title__c", "Name") as string | undefined)?.trim();
    if (title && !unique.includes(title)) unique.push(title);
  }
  if (unique.length === 0) return originalName;

  const origLower = originalName.toLowerCase().trim();
  for (const t of unique) if (t.toLowerCase().trim() === origLower) return t;

  const prompt =
    `We want to find a product similar to '${originalName}' from the user's ` +
    "previously ordered items. " +
    `Original requested name: '${originalName}'\n` +
    `Previously purchased products: ${JSON.stringify(unique)}\n\n` +
    "Select the best matching product from the previously purchased list that " +
    "represents the original requested name. " +
    "For example, if the requested name is 'onion', and previously purchased items " +
    "has 'Fresh Onion', select 'Fresh Onion'. " +
    "If none of the previously purchased products is a good match for the requested " +
    "product, return 'NONE'. " +
    "Respond only with the exact product title from the list, or 'NONE'.";

  const matched = await callDeepseek(s, prompt);
  if (matched && matched !== "NONE") {
    const ml = matched.toLowerCase().trim();
    for (const t of unique) if (t.toLowerCase().trim() === ml) return t;
  }
  return originalName;
}

async function resolveCross(
  s: Settings,
  sf: SalesforceClient,
  name: string,
  targetSource: string,
): Promise<string> {
  const core = await extractCoreKeyword(s, name);
  return resolveName(s, sf, core, targetSource);
}

async function postToStore(
  url: string,
  products: string[],
  label: string,
): Promise<CartCheckoutResponse> {
  if (!url) throw new Error(`${label} cart checkout is not configured.`);

  let resp: Response | null = null;
  for (let attempt = 0; attempt <= BUSY_RETRY_ATTEMPTS; attempt++) {
    resp = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ products }) },
      60_000,
    );
    if (resp.status !== 409) break;
    if (attempt < BUSY_RETRY_ATTEMPTS) await sleep(BUSY_RETRY_DELAY_MS);
  }

  if (resp!.status === 409) {
    // Still busy after retries — accept so the cart clears; upstream drains later.
    return { submitted: products.length, detail: `Your ${label} order is being processed.` };
  }
  if (resp!.status >= 400) {
    const body = await resp!.text();
    throw new Error(`${label} Cart API error: HTTP ${resp!.status} — ${body.slice(0, 200)}`);
  }
  const detail =
    resp!.status === 202
      ? `Sent ${products.length} item(s) to ${label} — they'll appear in your store cart shortly.`
      : `Submitted ${products.length} item(s) to ${label}.`;
  return { submitted: products.length, detail };
}

/** Split items by source, cross-resolve each to the other store, and POST to the
 * per-store cart endpoints. One store failing does not sink the other. */
export async function submitCart(
  s: Settings,
  sf: SalesforceClient,
  products: Array<string | CartItemCheckout>,
): Promise<CartCheckoutResponse> {
  const tasks: Array<{ store: "Flipkart" | "Amazon"; promise: Promise<string> }> = [];

  for (const item of products) {
    let name = "";
    let source: string | null = null;
    if (typeof item === "string") name = item;
    else {
      name = item.name ?? "";
      source = item.source ?? null;
    }
    name = name.trim();
    if (!name) continue;

    const srcLower = source ? source.toLowerCase() : "";
    if (srcLower === "amazon") {
      tasks.push({ store: "Amazon", promise: resolveName(s, sf, name, "Amazon") });
      tasks.push({ store: "Flipkart", promise: resolveCross(s, sf, name, "Flipkart") });
    } else if (srcLower === "flipkart") {
      tasks.push({ store: "Flipkart", promise: resolveName(s, sf, name, "Flipkart") });
      tasks.push({ store: "Amazon", promise: resolveCross(s, sf, name, "Amazon") });
    } else {
      tasks.push({ store: "Flipkart", promise: resolveName(s, sf, name, "Flipkart") });
      tasks.push({ store: "Amazon", promise: resolveName(s, sf, name, "Amazon") });
    }
  }

  const resolved = await Promise.all(tasks.map((t) => t.promise));
  const flipkartItems: string[] = [];
  const amazonItems: string[] = [];
  resolved.forEach((nm, i) => {
    if (!nm) return;
    if (tasks[i].store === "Flipkart") flipkartItems.push(nm);
    else amazonItems.push(nm);
  });

  if (flipkartItems.length === 0 && amazonItems.length === 0) {
    return { submitted: 0, detail: "No valid items to submit." };
  }

  const postTasks: Array<Promise<CartCheckoutResponse>> = [];
  const labels: string[] = [];
  if (flipkartItems.length) {
    postTasks.push(postToStore(s.flipkartAddCartUrl, flipkartItems, "Flipkart"));
    labels.push("Flipkart");
  }
  if (amazonItems.length) {
    postTasks.push(postToStore(s.amazonAddCartUrl, amazonItems, "Amazon"));
    labels.push("Amazon");
  }

  const outcomes = await Promise.allSettled(postTasks);
  const results: CartCheckoutResponse[] = [];
  const failed: string[] = [];
  let firstError: unknown = null;
  outcomes.forEach((o, i) => {
    if (o.status === "rejected") {
      failed.push(labels[i]);
      if (firstError === null) firstError = o.reason;
    } else {
      results.push(o.value);
    }
  });

  if (results.length === 0 && firstError !== null) throw firstError;

  const total = results.reduce((n, r) => n + r.submitted, 0);
  const details = results.map((r) => r.detail);
  if (failed.length) details.push(`Couldn't submit to ${failed.join(", ")} — please try again.`);
  return { submitted: total, detail: details.join(" ") };
}
