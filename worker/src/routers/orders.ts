import { Hono } from "hono";

import type { Env } from "../env";
import { loadSettings } from "../lib/config";
import { submitOtp } from "../lib/otp";
import { SOURCE_LABELS, triggerRefresh } from "../lib/refresh";
import type { RefreshRequest } from "../models/schemas";

export const ordersRouter = new Hono<{ Bindings: Env }>();

ordersRouter.post("/api/products/refresh", async (c) => {
  const req = await c.req.json<RefreshRequest>();
  const s = loadSettings(c.env);
  const label = SOURCE_LABELS[req.source] ?? req.source;
  try {
    await triggerRefresh(s, req.source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/No refresh endpoint/.test(msg)) return c.json({ detail: msg }, 400);
    return c.json({ detail: `Could not start the ${label} refresh right now. Please try again.` }, 502);
  }
  return c.json({ detail: `Triggered an ${label} refresh. Updated data will appear shortly.` });
});

ordersRouter.post("/api/otp", async (c) => {
  const req = await c.req.json<{ otp: string }>();
  const s = loadSettings(c.env);
  try {
    await submitOtp(s, req.otp);
  } catch {
    return c.json({ detail: "Could not submit the OTP right now. Please try again." }, 502);
  }
  return c.json({ detail: "Submitted OTP." });
});
