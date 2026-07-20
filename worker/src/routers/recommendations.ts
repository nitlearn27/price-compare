import { Hono } from "hono";

import type { Env } from "../env";
import { loadSettings } from "../lib/config";
import { fetchNextPurchase } from "../lib/recommendations";
import { getSalesforceClient } from "../lib/salesforce";
import type { RecommendationRequest } from "../models/schemas";

export const recommendationsRouter = new Hono<{ Bindings: Env }>();

recommendationsRouter.post("/api/recommendations/next-purchase", async (c) => {
  const req = await c.req.json<RecommendationRequest>();
  const s = loadSettings(c.env);
  const userInput = (req.user_input ?? "").trim() || "Give recommendations";
  try {
    return c.json(await fetchNextPurchase(s, getSalesforceClient(s), userInput, req.refresh ?? false));
  } catch {
    return c.json(
      { detail: "The recommendation service is currently unavailable. Please try again." },
      502,
    );
  }
});
