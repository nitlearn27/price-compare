import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChat } from "../../src/hooks/useChat";
import { api } from "../../src/lib/api";

// The text chat path now goes through the agent (hub-spoke search happens
// server-side), so the hook only calls api.agentChat.
vi.mock("../../src/lib/api", () => ({
  api: { agentChat: vi.fn(), productsLive: vi.fn() },
}));

const mockApi = api as unknown as {
  agentChat: ReturnType<typeof vi.fn>;
  productsLive: ReturnType<typeof vi.fn>;
};

const FAKE_LISTING = {
  id: "1", title: "OnePlus 12", source: "Amazon", origin: "catalog",
  current_price: 5000, original_price: null, discount: null,
  rating: null, review_count: null, rank: null, product_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useChat agent flow", () => {
  it("sends the conversation to the agent and renders reply + results", async () => {
    mockApi.agentChat.mockResolvedValue({
      reply: "Here are the results.",
      results: [FAKE_LISTING],
      cart: [],
      checkout: null,
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("find OnePlus 12");
    });

    expect(mockApi.agentChat).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "find OnePlus 12" }],
    });
    const texts = result.current.messages.map((m) => m.content);
    expect(texts).toContain("Here are the results.");
    expect(result.current.productSearch.results).toHaveLength(1);
  });

  it("fetches and appends live results when the agent reports pending_live", async () => {
    mockApi.agentChat.mockResolvedValue({
      reply: "Catalog results; fetching live too…",
      results: [FAKE_LISTING],
      cart: [],
      checkout: null,
      pending_live: { query: "carrot", sources: ["flipkart"], min_price: null, max_price: null },
    });
    mockApi.productsLive.mockResolvedValue({
      results: [{ ...FAKE_LISTING, id: "2", source: "Flipkart", origin: "live" }],
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("carrot");
    });

    expect(mockApi.productsLive).toHaveBeenCalledWith({
      query: "carrot",
      sources: ["flipkart"],
      min_price: null,
      max_price: null,
    });
    // Catalog row + appended live row.
    expect(result.current.productSearch.results.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("surfaces an error message when the agent call fails", async () => {
    mockApi.agentChat.mockRejectedValue(new Error("AI down"));

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const texts = result.current.messages.map((m) => m.content);
    expect(texts.some((t) => /AI down/.test(t))).toBe(true);
  });
});
