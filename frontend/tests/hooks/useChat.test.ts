import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChat } from "../../src/hooks/useChat";
import { api } from "../../src/lib/api";

// The text chat path now goes through the agent (hub-spoke search happens
// server-side), so the hook only calls api.agentChat / api.agentChatStream.
vi.mock("../../src/lib/api", () => ({
  api: { agentChat: vi.fn(), agentChatStream: undefined, productsLive: vi.fn() },
}));

const mockApi = api as unknown as {
  agentChat: ReturnType<typeof vi.fn>;
  agentChatStream: ReturnType<typeof vi.fn> | undefined;
  productsLive: ReturnType<typeof vi.fn>;
};

const FAKE_LISTING = {
  id: "1", title: "OnePlus 12", source: "Amazon", origin: "catalog",
  current_price: 5000, original_price: null, discount: null,
  rating: null, review_count: null, rank: null, product_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.agentChatStream = undefined;
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
      thread_id: expect.any(String),
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

  it("prefers the streaming endpoint and does not also call agentChat", async () => {
    mockApi.agentChatStream = vi.fn().mockImplementation(async (_req, handlers) => {
      handlers?.onResults?.([FAKE_LISTING]);
      return { reply: "Streamed reply.", results: [FAKE_LISTING], cart: [], checkout: null };
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("find OnePlus 12");
    });

    expect(mockApi.agentChat).not.toHaveBeenCalled();
    expect(result.current.messages.map((m) => m.content)).toContain("Streamed reply.");
    expect(result.current.productSearch.results).toHaveLength(1);
  });

  it("applies a refined results event by replacing the fast set", async () => {
    // The validate pass emits a second `results` event with the irrelevant row
    // removed; the table must replace (not merge) so the dropped row disappears.
    const masala = { ...FAKE_LISTING, id: "9", title: "Butter Chicken Masala" };
    mockApi.agentChatStream = vi.fn().mockImplementation(async (_req, handlers) => {
      handlers?.onResults?.([FAKE_LISTING, masala]); // fast, deterministically-filtered
      handlers?.onResults?.([FAKE_LISTING]); // refined — masala dropped
      return { reply: "Refined.", results: [FAKE_LISTING], cart: [], checkout: null };
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("butter");
    });

    expect(result.current.productSearch.results.map((r) => r.id)).toEqual(["1"]);
  });

  it("falls back to agentChat when the stream fails before any progress", async () => {
    mockApi.agentChatStream = vi.fn().mockRejectedValue(new Error("HTTP 404"));
    mockApi.agentChat.mockResolvedValue({
      reply: "Fallback reply.",
      results: [],
      cart: [],
      checkout: null,
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockApi.agentChat).toHaveBeenCalledTimes(1);
    expect(result.current.messages.map((m) => m.content)).toContain("Fallback reply.");
  });

  it("does NOT fall back (re-running the turn) when the stream dies after a reply", async () => {
    // A prose-only turn emits reply → done with no status/results events. If the
    // stream drops after the reply, the turn already ran server-side — a fallback
    // would execute it a second time.
    mockApi.agentChatStream = vi.fn().mockImplementation(async (_req, handlers) => {
      handlers?.onReply?.("All done.");
      throw new Error("Stream ended without a result.");
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("thanks");
    });

    expect(mockApi.agentChat).not.toHaveBeenCalled();
    const texts = result.current.messages.map((m) => m.content);
    expect(texts.some((t) => /Stream ended without a result/.test(t))).toBe(true);
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
