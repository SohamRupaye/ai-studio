import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider } from "../anthropic.js";
import { OpenAICompatibleProvider } from "../openai_compatible.js";
import { OpenRouterProvider } from "../openrouter.js";
import { GoogleProvider } from "../google.js";
import type { StreamEvent } from "../base.js";

// ── SSE fixtures ──────────────────────────────────────────────────────────────
// Each provider's stream() reads res.body via getReader(); build a Response
// whose body streams the given SSE lines.

function sseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, text: async () => "" } as unknown as Response;
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function thinkingText(events: StreamEvent[]): string {
  return events.filter((e) => e.type === "thinking").map((e: any) => e.text).join("");
}

function plainText(events: StreamEvent[]): string {
  return events.filter((e) => e.type === "text").map((e: any) => e.text).join("");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thinking stream events", () => {
  it("Anthropic: thinking_delta yields thinking, text_delta stays text", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me consider" } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: " the options." } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Answer." } })}`,
        "data: [DONE]",
      ]),
    );
    const events = await collect(new AnthropicProvider("key").stream("claude-x", [{ role: "user", content: "q" }], "sys"));
    expect(thinkingText(events)).toBe("Let me consider the options.");
    expect(plainText(events)).toBe("Answer.");
  });

  it("OpenAI-compatible: reasoning_content deltas yield thinking", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Hmm, " } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "tricky." } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "42." } }] })}`,
        "data: [DONE]",
      ]),
    );
    const provider = new OpenAICompatibleProvider({ apiKey: "k", baseUrl: "http://x", name: "T" });
    const events = await collect(provider.stream("m", [{ role: "user", content: "q" }], "sys"));
    expect(thinkingText(events)).toBe("Hmm, tricky.");
    expect(plainText(events)).toBe("42.");
  });

  it("OpenRouter: reasoning deltas yield thinking", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "Working it out. " } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Done." } }] })}`,
        "data: [DONE]",
      ]),
    );
    const events = await collect(new OpenRouterProvider("k").stream("m", [{ role: "user", content: "q" }], "sys"));
    expect(thinkingText(events)).toBe("Working it out. ");
    expect(plainText(events)).toBe("Done.");
  });

  it("Google: parts flagged thought:true yield thinking, others text", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Plan first.", thought: true }, { text: "Reply." }] } }] })}`,
      ]),
    );
    const events = await collect(new GoogleProvider("k").stream("gemini-x", [{ role: "user", content: "q" }], "sys"));
    expect(thinkingText(events)).toBe("Plan first.");
    expect(plainText(events)).toBe("Reply.");
  });
});
