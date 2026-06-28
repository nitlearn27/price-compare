import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProductSearch } from "../../src/hooks/useProductSearch";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useProductSearch", () => {
  it("starts with empty results and no loading/error", () => {
    const { result } = renderHook(() => useProductSearch());
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets loading true during search", async () => {
    let resolve: (v: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    vi.spyOn(globalThis, "fetch").mockReturnValue(promise as Promise<Response>);

    const { result } = renderHook(() => useProductSearch());
    act(() => { result.current.search({ query: "test" }); });
    expect(result.current.loading).toBe(true);
    resolve!(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  });

  it("sets results on success", async () => {
    const mockResults = [
      {
        id: "1", title: "Phone", source: "Amazon",
        current_price: 5000, original_price: null, discount: null,
        rating: null, review_count: null, rank: null,
        product_url: null,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: mockResults }), { status: 200 })
    );

    const { result } = renderHook(() => useProductSearch());
    await act(async () => { await result.current.search({ query: "test" }); });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on fetch failure and returns -1", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Service down" }), { status: 502 })
    );

    const { result } = renderHook(() => useProductSearch());
    let count = 0;
    await act(async () => { count = await result.current.search({ query: "test" }); });

    expect(count).toBe(-1);
    expect(result.current.error).not.toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("search returns the result count and tags searchedVia salesforce", async () => {
    const mockResults = [
      {
        id: "1", title: "Phone", source: "Amazon",
        current_price: 5000, original_price: null, discount: null,
        rating: null, review_count: null, rank: null, product_url: null,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: mockResults }), { status: 200 })
    );

    const { result } = renderHook(() => useProductSearch());
    let count = 0;
    await act(async () => { count = await result.current.search({ query: "test" }); });

    expect(count).toBe(1);
    expect(result.current.searchedVia).toBe("salesforce");
  });

  it("appendResults adds new rows, dedupes by id, and clears loadingLive", () => {
    const base = {
      title: "P", source: "Amazon", current_price: 1, original_price: null,
      last_purchased_price: null, discount: null, rating: null, review_count: null,
      rank: null, product_url: null, image_url: null, availability: null,
      last_ordered_date: null, times_purchased: null, buy_suggestion: null,
      suggestion_reason: null,
    };
    const { result } = renderHook(() => useProductSearch());

    act(() => {
      result.current.setResults([{ id: "1", ...base }], "salesforce");
      result.current.setLoadingLive(true);
    });
    expect(result.current.loadingLive).toBe(true);

    act(() => {
      // "1" is a dup (skipped), "2" is appended.
      result.current.appendResults([{ id: "1", ...base }, { id: "2", ...base, source: "Flipkart" }]);
    });

    expect(result.current.results.map((r) => r.id)).toEqual(["1", "2"]);
    expect(result.current.loadingLive).toBe(false);
  });

  it("searchFlipkart sets results and tags searchedVia flipkart", async () => {
    const mockResults = [
      {
        id: "fk1", title: "Phone", source: "Flipkart",
        current_price: 5000, original_price: null, discount: null,
        rating: null, review_count: null, rank: null, product_url: null,
        buy_suggestion: "new",
      },
    ];
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: mockResults }), { status: 200 })
    );

    const { result } = renderHook(() => useProductSearch());
    await act(async () => { await result.current.searchFlipkart({ query: "test" }); });

    expect(spy).toHaveBeenCalledWith(
      "/api/products/search/flipkart",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.results).toHaveLength(1);
    expect(result.current.searchedVia).toBe("flipkart");
  });
});
