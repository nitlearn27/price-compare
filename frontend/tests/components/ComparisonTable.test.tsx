import { render as rtlRender, screen } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { ComparisonTable } from "../../src/components/results/ComparisonTable";
import { CartProvider } from "../../src/hooks/useCart";
import type { ProductListing } from "../../src/lib/types";

// ComparisonTable renders AddToCartButton, which needs a CartProvider in scope.
const render = (ui: ReactNode) => rtlRender(<CartProvider>{ui}</CartProvider>);

/** Force `useMediaQuery` to report a mobile viewport for the duration of a test. */
function mockMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function makeListing(overrides: Partial<ProductListing> = {}): ProductListing {
  return {
    id: "1",
    title: "OnePlus 12 5G",
    source: "Amazon",
    current_price: 62000,
    original_price: 70000,
    last_purchased_price: null,
    discount: 11,
    rating: "4.5",
    review_count: 5000,
    rank: 1,
    product_url: "https://amazon.in/dp/x",
    image_url: null,
    availability: "In Stock",
    last_ordered_date: null,
    times_purchased: null,
    buy_suggestion: null,
    suggestion_reason: null,
    ...overrides,
  };
}

describe("ComparisonTable", () => {
  it("shows empty state when a search returned no results", () => {
    render(<ComparisonTable results={[]} loading={false} error={null} hasSearched />);
    expect(screen.getByText(/no products found/i)).toBeInTheDocument();
  });

  it("shows the idle state (not 'No products found') before any search", () => {
    render(
      <ComparisonTable results={[]} loading={false} error={null} hasSearched={false} />,
    );
    expect(screen.getByText(/ready when you are/i)).toBeInTheDocument();
    expect(screen.queryByText(/no products found/i)).toBeNull();
  });

  it("shows loading skeletons when loading", () => {
    render(<ComparisonTable results={[]} loading={true} error={null} />);
    expect(screen.getByLabelText(/loading product results/i)).toBeInTheDocument();
  });

  it("shows error message when error provided", () => {
    render(<ComparisonTable results={[]} loading={false} error="Network error" />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("renders product title", () => {
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    expect(screen.getByText("OnePlus 12 5G")).toBeInTheDocument();
  });

  it("renders source group header", () => {
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    // Source name and result count are in separate spans for distinct styling
    expect(screen.getAllByText(/Amazon/).length).toBeGreaterThan(0);
    expect(screen.getByText(/— 1 result/)).toBeInTheDocument();
  });

  it("renders 'Top match' badge on first row of each group", () => {
    const results = [
      makeListing({ id: "1", source: "Amazon" }),
      makeListing({ id: "2", source: "Amazon", title: "OnePlus 12 512GB" }),
    ];
    render(<ComparisonTable results={results} loading={false} error={null} />);
    const badges = screen.getAllByText(/top match/i);
    expect(badges).toHaveLength(1);
  });

  it("renders a 'New' badge only for live (website) results", () => {
    const results = [
      makeListing({ id: "1", source: "Amazon", origin: "catalog" }),
      makeListing({ id: "2", source: "Flipkart", title: "Live item", origin: "live" }),
    ];
    render(<ComparisonTable results={results} loading={false} error={null} />);
    expect(screen.getAllByText(/^New$/)).toHaveLength(1);
  });

  it("renders the weight value", () => {
    render(
      <ComparisonTable
        results={[makeListing({ weight: "500 g" })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("500 g")).toBeInTheDocument();
  });

  it("renders availability text", () => {
    render(
      <ComparisonTable
        results={[makeListing({ availability: "Out of Stock" })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
  });

  it("renders formatted last ordered date", () => {
    render(
      <ComparisonTable
        results={[makeListing({ last_ordered_date: "2026-04-12" })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/12 Apr 2026/)).toBeInTheDocument();
  });

  it("renders View link with correct href", () => {
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    const link = screen.getByRole("link", { name: /view/i });
    expect(link).toHaveAttribute("href", "https://amazon.in/dp/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("groups multiple sources with separate headers", () => {
    const results = [
      makeListing({ id: "1", source: "Amazon" }),
      makeListing({ id: "2", source: "Flipkart" }),
    ];
    render(<ComparisonTable results={results} loading={false} error={null} />);
    expect(screen.getAllByText(/Amazon/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Flipkart/).length).toBeGreaterThan(0);
  });

  it("renders the Buy? column header", () => {
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    expect(screen.getByText("Buy?")).toBeInTheDocument();
  });

  it("renders a SuggestionBadge when buy_suggestion is set", () => {
    render(
      <ComparisonTable
        results={[
          makeListing({
            buy_suggestion: "frequent",
            suggestion_reason: "Bought 4x, last 12 days ago",
          }),
        ]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/frequent buy/i)).toBeInTheDocument();
  });

  it("renders the Last Paid and Trend column headers", () => {
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    expect(screen.getByText("Last Paid")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("renders the last purchased price", () => {
    render(
      <ComparisonTable
        results={[makeListing({ current_price: 62000, last_purchased_price: 59999 })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("₹59,999")).toBeInTheDocument();
  });

  it("shows an up trend when current price is above last paid", () => {
    render(
      <ComparisonTable
        results={[makeListing({ current_price: 62000, last_purchased_price: 59000 })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/up .* versus last paid/i)).toBeInTheDocument();
  });

  it("shows a down trend when current price is below last paid", () => {
    render(
      <ComparisonTable
        results={[makeListing({ current_price: 59000, last_purchased_price: 62000 })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/down .* versus last paid/i)).toBeInTheDocument();
  });

  it("shows a neutral trend when last paid is unknown", () => {
    render(
      <ComparisonTable
        results={[makeListing({ last_purchased_price: null })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/no price change/i)).toBeInTheDocument();
  });
});

describe("ComparisonTable — mobile card layout", () => {
  afterEach(() => {
    // Restore the jsdom default (no matchMedia → desktop) for other suites.
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.restoreAllMocks();
  });

  it("renders product cards instead of a table on mobile", () => {
    mockMobileViewport(true);
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    // No table is rendered on mobile…
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // …but the product content still appears as a card.
    expect(screen.getByText("OnePlus 12 5G")).toBeInTheDocument();
    expect(screen.getByText(/— 1 result/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute(
      "href",
      "https://amazon.in/dp/x",
    );
  });

  it("shows card skeletons while loading on mobile", () => {
    mockMobileViewport(true);
    render(<ComparisonTable results={[]} loading error={null} />);
    expect(screen.getByLabelText(/loading product results/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the desktop table when not mobile", () => {
    mockMobileViewport(false);
    render(<ComparisonTable results={[makeListing()]} loading={false} error={null} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows last paid price and trend on a mobile card", () => {
    mockMobileViewport(true);
    render(
      <ComparisonTable
        results={[makeListing({ current_price: 62000, last_purchased_price: 59000 })]}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Last Paid: ₹59,000/)).toBeInTheDocument();
    expect(screen.getByLabelText(/up .* versus last paid/i)).toBeInTheDocument();
  });
});
