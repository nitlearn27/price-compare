import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RecommendationsDrawer } from "../../src/components/recommendations/RecommendationsDrawer";
import type { RecommendationsState } from "../../src/hooks/useRecommendations";
import type { RecommendationItem } from "../../src/lib/types";

function makeItem(overrides: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    product_name: "Aashirvaad Atta 5kg",
    product_url: "https://www.amazon.in/gp/product/B009BA7S8M",
    price: 324,
    reasoning: "Last purchased 9 days ago; now on sale.",
    rating: "Not available",
    ...overrides,
  };
}

function makeState(overrides: Partial<RecommendationsState> = {}): RecommendationsState {
  return {
    insight: null,
    recommendations: [],
    loading: false,
    error: null,
    fetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("RecommendationsDrawer", () => {
  it("auto-fetches on first open", () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    render(<RecommendationsDrawer open onClose={() => {}} state={makeState({ fetch })} />);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows loading shimmer state", () => {
    render(
      <RecommendationsDrawer open onClose={() => {}} state={makeState({ loading: true })} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error state with detail", () => {
    render(
      <RecommendationsDrawer
        open
        onClose={() => {}}
        state={makeState({ error: "Service down" })}
      />,
    );
    expect(screen.getByText(/couldn't load recommendations/i)).toBeInTheDocument();
    expect(screen.getByText(/service down/i)).toBeInTheDocument();
  });

  it("renders the insight banner", () => {
    render(
      <RecommendationsDrawer
        open
        onClose={() => {}}
        state={makeState({ insight: "You're due for a refill." })}
      />,
    );
    expect(screen.getByText(/you're due for a refill/i)).toBeInTheDocument();
  });

  it("renders a recommendation card with name, INR price, reasoning, and View link", () => {
    render(
      <RecommendationsDrawer
        open
        onClose={() => {}}
        state={makeState({ insight: "i", recommendations: [makeItem()] })}
      />,
    );
    expect(screen.getByText("Aashirvaad Atta 5kg")).toBeInTheDocument();
    expect(screen.getByText(/₹324/)).toBeInTheDocument();
    expect(screen.getByText(/last purchased 9 days ago/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view aashirvaad/i });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hides rating when 'Not available'", () => {
    render(
      <RecommendationsDrawer
        open
        onClose={() => {}}
        state={makeState({ insight: "i", recommendations: [makeItem({ rating: "Not available" })] })}
      />,
    );
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("shows rating when available", () => {
    render(
      <RecommendationsDrawer
        open
        onClose={() => {}}
        state={makeState({ insight: "i", recommendations: [makeItem({ rating: "4.5" })] })}
      />,
    );
    expect(screen.getByText(/★ 4.5/)).toBeInTheDocument();
  });

  it("clicking a source chip fills the preference input", () => {
    render(<RecommendationsDrawer open onClose={() => {}} state={makeState()} />);
    fireEvent.click(screen.getByRole("button", { name: "Flipkart" }));
    const input = screen.getByLabelText(/preference/i) as HTMLInputElement;
    expect(input.value).toBe("give recommendations from only Flipkart");
  });

  it("re-fetches with the typed preference on submit", () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    render(<RecommendationsDrawer open onClose={() => {}} state={makeState({ fetch })} />);
    const input = screen.getByLabelText(/preference/i);
    fireEvent.change(input, { target: { value: "only flipkart" } });
    fireEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
    expect(fetch).toHaveBeenLastCalledWith("only flipkart");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<RecommendationsDrawer open onClose={onClose} state={makeState()} />);
    fireEvent.click(screen.getByRole("button", { name: /close recommendations/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
