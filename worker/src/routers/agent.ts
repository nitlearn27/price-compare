import { Hono } from "hono";

import { ShoppingAgent } from "../agent/agent";
import type { Env } from "../env";
import { loadSettings } from "../lib/config";
import { extractOtp, submitOtp } from "../lib/otp";
import type { AgentResponse, ChatRequest } from "../models/schemas";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function otpResponse(otp: string, threadId: string | null): AgentResponse {
  return {
    reply: `Submitted OTP **${otp}**.`,
    results: [],
    cart: [],
    checkout: null,
    pending_live: null,
    thread_id: threadId,
  };
}

export const agentRouter = new Hono<{ Bindings: Env }>();

agentRouter.post("/api/agent/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const settings = loadSettings(c.env);
  const threadId = body.thread_id ?? null;

  // OTP short-circuit — runs before (and instead of) the model.
  const latest = body.messages[body.messages.length - 1];
  if (latest?.role === "user") {
    const otp = extractOtp(latest.content);
    if (otp) {
      try {
        await submitOtp(settings, otp);
      } catch {
        return c.json({ detail: "Could not submit the OTP right now. Please try again." }, 502);
      }
      return c.json(otpResponse(otp, threadId));
    }
  }

  const agent = new ShoppingAgent(c.env, settings);
  try {
    return c.json(await agent.run(body.messages, threadId));
  } catch {
    return c.json({ detail: "The AI service is currently unavailable. Please try again." }, 502);
  }
});

agentRouter.post("/api/agent/chat/stream", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const settings = loadSettings(c.env);
  const threadId = body.thread_id ?? null;
  const enc = new TextEncoder();
  const latest = body.messages[body.messages.length - 1];

  // OTP short-circuit (mirrors the non-streaming endpoint).
  if (latest?.role === "user") {
    const otp = extractOtp(latest.content);
    if (otp) {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            await submitOtp(settings, otp);
            controller.enqueue(enc.encode(sse("done", otpResponse(otp, threadId))));
          } catch {
            controller.enqueue(
              enc.encode(sse("error", { detail: "Could not submit the OTP right now. Please try again." })),
            );
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    }
  }

  const agent = new ShoppingAgent(c.env, settings);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const [event, data] of agent.runStream(body.messages, threadId)) {
          controller.enqueue(enc.encode(sse(event, data)));
        }
      } catch {
        controller.enqueue(
          enc.encode(sse("error", { detail: "The AI service is currently unavailable. Please try again." })),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
});
