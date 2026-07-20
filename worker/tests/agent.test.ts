import { afterEach, describe, expect, it, vi } from "vitest";

import { ShoppingAgent } from "../src/agent/agent";
import { loadSettings, type Settings } from "../src/lib/config";
import type { Env } from "../src/env";

// A minimal Env with the keys the agent reads; AGENT_STATE omitted so the
// stateless (no thread_id) path is exercised.
const FAKE_ENV = {
  DEEPSEEK_API_KEY: "test-deepseek",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1/chat/completions",
  SF_TOKEN_URL: "https://login.salesforce.com/services/oauth2/token",
  SF_CLIENT_ID: "cid",
  SF_CLIENT_SECRET: "secret",
  SF_API_VERSION: "60.0",
} as unknown as Env;

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...loadSettings(FAKE_ENV), ...overrides };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const textResponse = (content: string) => ({
  choices: [{ message: { role: "assistant", content } }],
});

const searchCall = (query: string) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "search_products", arguments: JSON.stringify({ query }) },
          },
        ],
      },
    },
  ],
  usage: { total_tokens: 0 },
});

/** Install a global fetch that dispatches by URL: Salesforce token/query and the
 * DeepSeek/OpenRouter chat endpoint (scripted from a queue). */
function installFetch(
  llmQueue: unknown[],
  records: Record<string, unknown>[],
  capture?: string[],
): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      return json({ access_token: "tok", instance_url: "https://test.salesforce.com", expires_in: 7200 });
    }
    if (url.includes("/query")) return json({ records });
    if (url.includes("deepseek") || url.includes("openrouter")) {
      if (capture && typeof init?.body === "string") capture.push(init.body);
      const next = llmQueue.shift();
      return json(next);
    }
    return json({}, 404);
  });
}

const RECORD = { Id: "1", Title__c: "SanDisk Pen Drive", Source__c: "Flipkart", Current_Price__c: 249 };

afterEach(() => vi.unstubAllGlobals());

describe("ShoppingAgent (LangGraph port)", () => {
  it("plain reply makes no tool calls", async () => {
    installFetch([textResponse("Hi!")], []);
    const resp = await new ShoppingAgent(FAKE_ENV, makeSettings()).run([
      { role: "user", content: "hello" },
    ]);
    expect(resp.reply).toBe("Hi!");
    expect(resp.results).toEqual([]);
  });

  it("runs the loop: search → tool result → final reply", async () => {
    installFetch([searchCall("pen drive"), textResponse("Best value is the Flipkart one.")], [RECORD]);
    const resp = await new ShoppingAgent(FAKE_ENV, makeSettings()).run([
      { role: "user", content: "pen drive" },
    ]);
    expect(resp.reply).toBe("Best value is the Flipkart one.");
    expect(resp.results.length).toBeGreaterThan(0);
    expect(resp.results[0].title).toBe("SanDisk Pen Drive");
  });

  it("validate node drops irrelevant rows, refines the set, and pins the reply", async () => {
    // All three titles contain the token "butter", so the deterministic filter
    // keeps them; the LLM validate pass then drops the non-butter item.
    const records = [
      { Id: "1", Title__c: "Amul Butter 500g", Source__c: "Flipkart", Current_Price__c: 250 },
      { Id: "2", Title__c: "Nandini Butter 100g", Source__c: "Flipkart", Current_Price__c: 55 },
      { Id: "3", Title__c: "Butter Chicken Masala", Source__c: "Flipkart", Current_Price__c: 80 },
    ];
    const sent: string[] = [];
    installFetch(
      [searchCall("butter"), textResponse("[0,1]"), textResponse("Two good butters.")],
      records,
      sent,
    );
    const resp = await new ShoppingAgent(FAKE_ENV, makeSettings()).run([
      { role: "user", content: "butter" },
    ]);
    expect(resp.results.map((r) => r.title)).toEqual(["Amul Butter 500g", "Nandini Butter 100g"]);
    expect(resp.reply).toBe("Two good butters.");
    // The reply-generation call (last LLM call) carries a relevance note listing
    // ONLY the kept rows, so the model's prose table matches the grid.
    const finalReq = sent[sent.length - 1];
    expect(finalReq).toContain("Relevance filter applied");
    expect(finalReq).toContain("- Amul Butter 500g (Flipkart)");
    expect(finalReq).toContain("- Nandini Butter 100g (Flipkart)");
    expect(finalReq).not.toContain("- Butter Chicken Masala");
  });

  it("validate is skipped when disabled (no extra LLM call consumed)", async () => {
    const records = [
      { Id: "1", Title__c: "Amul Butter", Source__c: "Flipkart", Current_Price__c: 250 },
      { Id: "2", Title__c: "Butter Chicken Masala", Source__c: "Flipkart", Current_Price__c: 80 },
    ];
    // Only two LLM turns scripted: if validate fired it would starve the queue.
    installFetch([searchCall("butter"), textResponse("done")], records);
    const resp = await new ShoppingAgent(
      FAKE_ENV,
      makeSettings({ agentValidateRelevance: false }),
    ).run([{ role: "user", content: "butter" }]);
    expect(resp.results.length).toBe(2);
    expect(resp.reply).toBe("done");
  });

  it("loop cap stops after agent_max_steps then finalizes", async () => {
    installFetch([searchCall("x"), searchCall("x"), textResponse("stopped")], []);
    const resp = await new ShoppingAgent(FAKE_ENV, makeSettings({ agentMaxSteps: 2 })).run([
      { role: "user", content: "loop forever" },
    ]);
    expect(resp.reply).toBe("stopped");
  });

  it("streams status → results → reply → done", async () => {
    installFetch([searchCall("pen drive"), textResponse("Best value is the Flipkart one.")], [RECORD]);
    const events: [string, unknown][] = [];
    for await (const ev of new ShoppingAgent(FAKE_ENV, makeSettings()).runStream([
      { role: "user", content: "pen drive" },
    ])) {
      events.push(ev);
    }
    const names = events.map((e) => e[0]);
    expect(names[0]).toBe("status");
    expect(names).toContain("results");
    expect(names).toContain("reply");
    expect(names[names.length - 1]).toBe("done");
    const done = events.find((e) => e[0] === "done")![1] as { reply: string; results: unknown[] };
    expect(done.reply).toBe("Best value is the Flipkart one.");
    expect(done.results.length).toBeGreaterThan(0);
  });
});
