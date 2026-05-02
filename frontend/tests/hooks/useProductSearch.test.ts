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
        product_url: null, image_url: null, availability: null,
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

  it("sets error on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Service down" }), { status: 502 })
    );

    const { result } = renderHook(() => useProductSearch());
    await act(async () => { await result.current.search({ query: "test" }); });

    expect(result.current.error).not.toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
