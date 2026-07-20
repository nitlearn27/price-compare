import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./env";
import { loadSettings } from "./lib/config";
import { registerRoutes } from "./routers";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  const origins = loadSettings(c.env)
    .corsAllowOrigins.split(",")
    .map((o) => o.trim());
  return cors({
    origin: origins.includes("*") ? "*" : origins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

registerRoutes(app);

// Anything that reaches the Worker outside /api (shouldn't, given
// run_worker_first) falls back to the static assets / SPA index.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
