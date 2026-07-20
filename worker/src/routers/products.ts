import { Hono } from "hono";

import { makeAggregator } from "../agents/aggregator";
import type { SearchFilters } from "../agents/base";
import type { Env } from "../env";
import { loadSettings } from "../lib/config";
import { getSalesforceClient } from "../lib/salesforce";
import type { ProductQuery } from "../models/schemas";

export const productsRouter = new Hono<{ Bindings: Env }>();

productsRouter.post("/api/products/live", async (c) => {
  const q = await c.req.json<ProductQuery>();
  if (!q.query?.trim()) return c.json({ detail: "Search query must not be empty." }, 400);
  const s = loadSettings(c.env);
  const sf = getSalesforceClient(s);
  const filters: SearchFilters = { min_price: q.min_price ?? null, max_price: q.max_price ?? null };
  try {
    const agg = await makeAggregator(s, sf).searchLive(q.query, s.sfResultsPerSource, filters, q.sources ?? null);
    return c.json({ results: agg.listings });
  } catch {
    return c.json(
      { detail: "The live product search is currently unavailable. Please try again." },
      502,
    );
  }
});
