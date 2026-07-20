import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useProductSearch } from "../../src/hooks/useProductSearch";

// The agent performs all searching server-side; this hook is now pure UI state
// for the comparison table (results, loading flags, error, searchedVia).

const BASE = {
  title: "P", source: "Amazon", current_price: 1, original_price: null,
  last_purchased_price: null, discount: null, rating: null, review_count: null,
  rank: null, product_url: null, image_url: null, availability: null,
  last_ordered_date: null, times_purchased: null, buy_suggestion: null,
  suggestion_reason: null,
};

describe("useProductSearch", () => {
  it("starts with empty results and no loading/error", () => {
    const { result } = renderHook(() => useProductSearch());
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.searchedVia).toBeNull();
  });

  it("setResults stores rows, tags searchedVia, and clears loading", () => {
    const { result } = renderHook(() => useProductSearch());

    act(() => {
      result.current.setLoading(true);
    });
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.setResults([{ id: "1", ...BASE }], "salesforce");
    });
    expect(result.current.results).toHaveLength(1);
    expect(result.current.searchedVia).toBe("salesforce");
    expect(result.current.loading).toBe(false);
  });

  it("setError clears loading and keeps the message", () => {
    const { result } = renderHook(() => useProductSearch());

    act(() => {
      result.current.setLoading(true);
      result.current.setError("Service down");
    });
    expect(result.current.error).toBe("Service down");
    expect(result.current.loading).toBe(false);
  });

  it("appendResults adds new rows, dedupes by id, and clears loadingLive", () => {
    const { result } = renderHook(() => useProductSearch());

    act(() => {
      result.current.setResults([{ id: "1", ...BASE }], "salesforce");
      result.current.setLoadingLive(true);
    });
    expect(result.current.loadingLive).toBe(true);

    act(() => {
      // "1" is a dup (skipped), "2" is appended.
      result.current.appendResults([{ id: "1", ...BASE }, { id: "2", ...BASE, source: "Flipkart" }]);
    });

    expect(result.current.results.map((r) => r.id)).toEqual(["1", "2"]);
    expect(result.current.loadingLive).toBe(false);
  });
});
