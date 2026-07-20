import type { Hono } from "hono";

import type { Env } from "../env";
import { agentRouter } from "./agent";
import { cartRouter } from "./cart";
import { identifyRouter } from "./identify";
import { ordersRouter } from "./orders";
import { productsRouter } from "./products";
import { recommendationsRouter } from "./recommendations";

type App = Hono<{ Bindings: Env }>;

/** Mount every /api router. */
export function registerRoutes(app: App): void {
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  for (const r of [
    agentRouter,
    productsRouter,
    cartRouter,
    ordersRouter,
    recommendationsRouter,
    identifyRouter,
  ]) {
    app.route("/", r);
  }
}
