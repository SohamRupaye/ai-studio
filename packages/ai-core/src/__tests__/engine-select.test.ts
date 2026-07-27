import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: { signedIn: true, detectedVia: "keychain" as const, apiKeyInEnv: false },
}));

// Only the session probe is faked — the real namespace helpers
// (isClaudeSubscriptionModel) are what's under test alongside selectEngine.
vi.mock("@squirl/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squirl/providers")>();
  return { ...actual, detectLocalClaudeSession: () => h.session };
});

// The SDK spawns a native binary on import paths we don't exercise here.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));

const { selectEngine } = await import("../engine.js");

beforeEach(() => {
  h.session = { signedIn: true, detectedVia: "keychain", apiKeyInEnv: false };
});

describe("selectEngine", () => {
  it("stays native when the flag is off, even with a session and a subscription model", () => {
    expect(
      selectEngine({ model: "claude_subscription/claude-opus-4-8", subscriptionEngineEnabled: false }),
    ).toEqual({ engine: "native", reason: "subscription engine not enabled" });
  });

  it("keeps a bare claude id on the native loop", () => {
    // A bare id comes from the API-key `anthropic` entry: BYOK must keep its own
    // billing, tool transparency and hallucination guard.
    const sel = selectEngine({ model: "claude-opus-4-8", subscriptionEngineEnabled: true });
    expect(sel.engine).toBe("native");
    expect(sel.reason).toMatch(/not a subscription model/);
  });

  it("keeps a namespaced third-party claude id (bedrock) on the native loop", () => {
    const sel = selectEngine({ model: "bedrock/claude-opus-4-8", subscriptionEngineEnabled: true });
    expect(sel.engine).toBe("native");
  });

  it("routes a subscription id to the SDK engine", () => {
    const sel = selectEngine({
      model: "claude_subscription/claude-opus-4-8",
      subscriptionEngineEnabled: true,
    });
    expect(sel.engine).toBe("claude-sdk");
    expect(sel.reason).toMatch(/keychain/);
  });

  it("falls back to native when no local session is detected", () => {
    h.session = { signedIn: false, detectedVia: "none" as never, apiKeyInEnv: false };
    const sel = selectEngine({
      model: "claude_subscription/claude-opus-4-8",
      subscriptionEngineEnabled: true,
    });
    expect(sel.engine).toBe("native");
    expect(sel.reason).toMatch(/no local Claude Code session/);
  });
});
