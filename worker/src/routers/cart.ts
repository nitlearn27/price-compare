import { Hono } from "hono";

import type { Env } from "../env";
import { submitCart } from "../lib/cart";
import { loadSettings } from "../lib/config";
import { getSalesforceClient } from "../lib/salesforce";
import type { CartCheckoutRequest } from "../models/schemas";

export const cartRouter = new Hono<{ Bindings: Env }>();

cartRouter.post("/api/cart/checkout", async (c) => {
  const req = await c.req.json<CartCheckoutRequest>();
  const s = loadSettings(c.env);
  try {
    return c.json(await submitCart(s, getSalesforceClient(s), req.products));
  } catch {
    return c.json({ detail: "The order service is currently unavailable. Please try again." }, 502);
  }
});
