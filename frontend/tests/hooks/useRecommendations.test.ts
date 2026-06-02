import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRecommendations } from "../../src/hooks/useRecommendations";

beforeEach(() => {
  vi.restoreAllMocks();
});

const okResponse = {
  insight_message: "You're due for a refill.",
  recommendations: [
    {
      product_name: "Atta 5kg",
      product_url: "https://amazon.in/x",
      price: 324,
      reasoning: "On sale",
      rating: "Not available",
    },
  ],
};

describe("useRecommendations", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useRecommendations());
    expect(result.current.insight).toBeNull();
    expect(result.current.recommendations).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets loading true during fetch", () => {
    let resolve: (v: unknown) => void;
    const promise = new Promise((r) => {
      resolve = r;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(promise as Promise<Response>);

    const { result } = renderHook(() => useRecommendations());
    act(() => {
      result.current.fetch("");
    });
    expect(result.current.loading).toBe(true);
    resolve!(new Response(JSON.stringify(okResponse), { status: 200 }));
  });

  it("defaults blank input to 'Give recommendations'", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(okResponse), { status: 200 }));

    const { result } = renderHook(() => useRecommendations());
    await act(async () => {
      await result.current.fetch("   ");
    });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_input).toBe("Give recommendations");
  });

  it("sets insight and recommendations on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(okResponse), { status: 200 }),
    );

    const { result } = renderHook(() => useRecommendations());
    await act(async () => {
      await result.current.fetch("only flipkart");
    });

    expect(result.current.insight).toBe(okResponse.insight_message);
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Service down" }), { status: 502 }),
    );

    const { result } = renderHook(() => useRecommendations());
    await act(async () => {
      await result.current.fetch("");
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.recommendations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
