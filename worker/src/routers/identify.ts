import { Hono } from "hono";

import type { Env } from "../env";
import { analyzeRestockCandidates, type RestockCandidate } from "../lib/cart_analysis";
import { loadSettings } from "../lib/config";
import { identifyProductsInImage } from "../lib/gemini";
import {
  ciGet,
  normalize,
  parseSfDate,
  rankAndGroup,
  safeFloat,
  safeInt,
  utcToday,
} from "../lib/product_search";
import { getSalesforceClient } from "../lib/salesforce";
import type { IdentifyRequest, MustHaveProduct, ProductListing } from "../models/schemas";

const RESTOCK_LOOKBACK_DAYS = 30;
const RECENT_PURCHASE_SKIP_DAYS = 5;

const VEGETABLE_KEYWORDS = [
  "tomato", "potato", "onion", "garlic", "ginger", "lemon", "lime",
  "chili", "chilli", "carrot", "broccoli", "spinach", "lettuce", "cabbage",
  "cauliflower", "cucumber", "coriander", "mint", "capsicum", "pepper",
  "mushroom", "corn", "pea", "beans", "ladyfinger", "bhindi", "brinjal",
  "eggplant", "radish", "turnip", "beetroot", "pumpkin", "gourd", "zucchini",
  "okra", "vegetable",
];

function isVegetable(title: string): boolean {
  const t = title.toLowerCase();
  return VEGETABLE_KEYWORDS.some((kw) => t.includes(kw));
}

export const identifyRouter = new Hono<{ Bindings: Env }>();

identifyRouter.post("/api/identify", async (c) => {
  const request = await c.req.json<IdentifyRequest>();
  const s = loadSettings(c.env);
  const sf = getSalesforceClient(s);

  try {
    // 1. Identify objects (Gemini → OpenRouter fallback).
    const gemini = await identifyProductsInImage(s, request.image, request.mime_type ?? "image/jpeg");
    const items = gemini.items ?? [];

    let productNames = items.filter((i) => i.confidence === "high" || i.confidence === "medium").map((i) => i.name);
    if (productNames.length === 0) productNames = items.map((i) => i.name);
    if (productNames.length === 0) {
      return c.json({
        reply: "Couldn't identify grocery items. Please try a clearer picture.",
        results: [],
        must_have: [],
      });
    }

    const itemsListMd = items.map((i) => `- **${i.name}** (${i.confidence ?? "unknown"})`).join("\n");
    let replyMsg = `**Identified items:**\n${itemsListMd}\n\nUpdated the comparison table with these products.`;

    // 2. Find run-low staple vegetables not visible in the photo.
    const today = utcToday();
    let recentRecords: Record<string, unknown>[] = [];
    try {
      recentRecords = await sf.getRecentProducts(RESTOCK_LOOKBACK_DAYS);
    } catch {
      recentRecords = [];
    }

    const grouped = new Map<string, { score: [number, number]; record: Record<string, unknown> }>();
    for (const record of recentRecords) {
      const title = String((ciGet(record, "Title__c") ?? ciGet(record, "Name")) ?? "");
      if (!isVegetable(title)) continue;

      const isVisible = productNames.some((p) => {
        const pn = p.toLowerCase().trim();
        const tn = title.toLowerCase().trim();
        return pn.includes(tn) || tn.includes(pn);
      });
      if (isVisible) continue;

      let vegKey = "vegetable";
      for (const kw of VEGETABLE_KEYWORDS) {
        if (title.toLowerCase().includes(kw)) {
          vegKey = kw;
          break;
        }
      }

      const times = safeInt(ciGet(record, "Number_Of_Times_Purchased__c")) ?? 0;
      const rating = safeFloat(ciGet(record, "Rating__c")) ?? 0;
      const score: [number, number] = [times, rating];
      const existing = grouped.get(vegKey);
      const better = !existing || score[0] > existing.score[0] || (score[0] === existing.score[0] && score[1] > existing.score[1]);
      if (better) grouped.set(vegKey, { score, record });
    }

    // Gate (a): drop anything bought within the freshness window.
    const candidates: Array<RestockCandidate & { normalized: ProductListing }> = [];
    const skippedFresh: string[] = [];
    for (const { score, record } of grouped.values()) {
      const normalized = normalize(record, today);
      const lastOrdered = parseSfDate(ciGet(record, "Last_Ordered_Date__c"));
      const daysSince = lastOrdered !== null ? Math.floor((today - lastOrdered) / 86400_000) : null;
      if (daysSince !== null && daysSince <= RECENT_PURCHASE_SKIP_DAYS) {
        skippedFresh.push(`${normalized.title} (${daysSince}d ago)`);
        continue;
      }
      candidates.push({
        name: normalized.title,
        times: score[0],
        days_since: daysSince !== null ? daysSince : "unknown",
        normalized,
      });
    }

    // Gate (b): DeepSeek decides which survivors genuinely need restocking.
    const decisions = await analyzeRestockCandidates(
      s,
      candidates.map((c2) => ({ name: c2.name, times: c2.times, days_since: c2.days_since })),
    );

    const mustHave: MustHaveProduct[] = [];
    const addedLines: string[] = [];
    const declined: string[] = [];
    for (const cand of candidates) {
      const dec = decisions[cand.normalized.title.toLowerCase().trim()];
      if (dec && dec.add) {
        mustHave.push({
          id: cand.normalized.id,
          title: cand.normalized.title,
          source: cand.normalized.source,
          reason: dec.reason || null,
        });
        addedLines.push(`**${cand.normalized.title}**${dec.reason ? ` — ${dec.reason}` : ""}`);
      } else {
        declined.push(cand.normalized.title);
      }
    }

    if (addedLines.length) {
      replyMsg += "\n\nAdded run-low staples to cart:\n" + addedLines.map((l) => `- ${l}`).join("\n");
    }
    if (skippedFresh.length) replyMsg += "\n\nRecently bought (skipped): " + skippedFresh.join(", ");
    if (declined.length) replyMsg += "\n\nStock sufficient (skipped): " + declined.join(", ");

    // 4. Query Salesforce for each visible product in parallel, then dedupe by id.
    const recordsLists = await Promise.allSettled(productNames.map((name) => sf.searchProducts(name)));
    const seen = new Set<string>();
    const results: ProductListing[] = [];
    recordsLists.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      for (const p of rankAndGroup(res.value, productNames[i], 3)) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
        }
      }
    });

    return c.json({ reply: replyMsg, results, must_have: mustHave });
  } catch {
    return c.json(
      { detail: "The image identification service is currently unavailable. Please try again." },
      502,
    );
  }
});
