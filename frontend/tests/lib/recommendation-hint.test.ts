import { describe, it, expect } from "vitest";
import { recommendationHint } from "../../src/lib/recommendation-hint";
import type { RecommendationItem } from "../../src/lib/types";

function item(overrides: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    product_name: "X",
    product_url: null,
    price: null,
    reasoning: null,
    rating: null,
    highlights: [],
    ...overrides,
  };
}

describe("recommendationHint", () => {
  it("maps restock-ish reasoning to 'Running low'", () => {
    expect(recommendationHint(item({ reasoning: "Likely due for a refill soon" })).label).toBe(
      "Running low",
    );
  });

  it("maps frequent-buy language to 'Your usual'", () => {
    expect(recommendationHint(item({ highlights: ["Daily staple", "Bought 4x"] })).label).toBe(
      "Your usual",
    );
  });

  it("maps discount language to 'Price drop'", () => {
    expect(recommendationHint(item({ reasoning: "Now on sale" })).label).toBe("Price drop");
  });

  it("falls back to a short highlight when no rule matches", () => {
    expect(recommendationHint(item({ highlights: ["Gift idea"] })).label).toBe("Gift idea");
  });

  it("defaults to 'For you' when nothing matches", () => {
    expect(recommendationHint(item({ reasoning: "" })).label).toBe("For you");
  });
});
