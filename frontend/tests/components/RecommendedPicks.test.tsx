import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { RecommendedPicks } from "../../src/components/recommendations/RecommendedPicks";
import { CartProvider } from "../../src/hooks/useCart";
import type { RecommendationsState } from "../../src/hooks/useRecommendations";

// RecommendedPicks renders AddToCartButton, which needs a CartProvider in scope.
const render = (ui: ReactNode) => rtlRender(<CartProvider>{ui}</CartProvider>);

function makeState(overrides: Record<string, unknown> = {}): RecommendationsState {
  return {
    insight: null,
    recommendations: [],
    loading: false,
    error: null,
    fetch: vi.fn(),
    ...overrides,
  } as unknown as RecommendationsState;
}

describe("RecommendedPicks", () => {
  it("renders a pick with name, price and a derived why-hint", () => {
    const state = makeState({
      recommendations: [
        {
          product_name: "Amul Milk",
          product_url: null,
          price: 54,
          reasoning: "Due for a refill",
          rating: null,
          highlights: [],
        },
      ],
    });
    render(<RecommendedPicks state={state} />);

    expect(screen.getByText("Amul Milk")).toBeInTheDocument();
    expect(screen.getByText(/₹54/)).toBeInTheDocument();
    expect(screen.getByText("Running low")).toBeInTheDocument(); // hint from "refill"
  });

  it("refresh button forces a re-fetch", () => {
    const fetch = vi.fn();
    render(<RecommendedPicks state={makeState({ fetch })} />);

    fireEvent.click(screen.getByLabelText(/refresh picks/i));
    expect(fetch).toHaveBeenCalledWith("", { refresh: true });
  });
});
