import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { CartProvider, useCart } from "../../src/hooks/useCart";
import { api } from "../../src/lib/api";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useCart", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toEqual([]);
    expect(result.current.count).toBe(0);
  });

  it("adds an item and reflects it in count and has()", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add({ id: "p1", name: "Amul Gold Milk", source: "Flipkart" }));
    expect(result.current.count).toBe(1);
    expect(result.current.has("p1")).toBe(true);
  });

  it("dedupes by id, not by name", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    // same id added twice → one item
    act(() => result.current.add({ id: "p1", name: "Amul Gold Milk", source: "Flipkart" }));
    act(() => result.current.add({ id: "p1", name: "Amul Gold Milk", source: "Flipkart" }));
    expect(result.current.count).toBe(1);
    // same name but different id → kept as a separate item (e.g. two Flipkart rows)
    act(() => result.current.add({ id: "p2", name: "Amul Gold Milk", source: "Amazon" }));
    expect(result.current.count).toBe(2);
    expect(result.current.has("p2")).toBe(true);
  });

  it("removes an item by id", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add({ id: "p1", name: "Tata Salt 1kg", source: null }));
    act(() => result.current.remove("p1"));
    expect(result.current.count).toBe(0);
    expect(result.current.has("p1")).toBe(false);
  });

  it("checkout posts names, then clears the cart and sets success", async () => {
    const spy = vi
      .spyOn(api, "checkoutCart")
      .mockResolvedValue({ submitted: 2, detail: "Submitted 2 item(s) to Flipkart." });

    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add({ id: "p1", name: "Amul Gold Milk", source: "Flipkart" }));
    act(() => result.current.add({ id: "p2", name: "Aashirvaad Atta 5kg", source: "Flipkart" }));

    await act(async () => { await result.current.checkout(); });

    expect(spy).toHaveBeenCalledWith({
      products: [
        { name: "Amul Gold Milk", source: "Flipkart" },
        { name: "Aashirvaad Atta 5kg", source: "Flipkart" },
      ],
    });
    expect(result.current.count).toBe(0);
    expect(result.current.success).toContain("Submitted");
    expect(result.current.error).toBeNull();
  });

  it("checkout surfaces an error and preserves the cart", async () => {
    vi.spyOn(api, "checkoutCart").mockRejectedValue(new Error("order service down"));

    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add({ id: "p1", name: "Amul Gold Milk", source: "Flipkart" }));

    await act(async () => { await result.current.checkout(); });

    expect(result.current.error).toBe("order service down");
    expect(result.current.count).toBe(1);
  });

  it("checkout is a no-op when the cart is empty", async () => {
    const spy = vi.spyOn(api, "checkoutCart");
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => { await result.current.checkout(); });
    expect(spy).not.toHaveBeenCalled();
  });
});
