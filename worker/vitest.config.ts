import { defineConfig } from "vitest/config";

// Plain Node environment — the deterministic ports (ranking, aggregator, agent
// graph) run in Node with a mocked global fetch. No workerd needed for these.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
