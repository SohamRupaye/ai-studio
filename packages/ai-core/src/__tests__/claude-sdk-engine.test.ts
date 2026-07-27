import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, AgentStreamEvent } from "../agent.js";

// The SDK spawns a native Claude Code binary, so the module is mocked wholesale
// and `query` replays a scripted message sequence. What's under test is the
// mapping from SDK messages onto AgentStreamEvent — where the bugs live.
const h = vi.hoisted(() => ({ messages: [] as any[], lastOptions: undefined as any }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(({ options }: any) => {
    h.lastOptions = options;
    return (async function* () {
      for (const m of h.messages) yield m;
    })();
  }),
  createSdkMcpServer: vi.fn((o: any) => ({ type: "sdk", name: o.name, tools: o.tools })),
  tool: vi.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
    name,
    description,
    schema,
    handler,
  })),
}));

const { runClaudeSdkEngine } = await import("../engines/claude-sdk.js");

function makeAgent(
  defs: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [],
  execute: () => Promise<{ title: string; output: string }> = async () => ({ title: "", output: "ok" }),
): Agent {
  return {
    getRegistry: () => ({
      getDefinitions: vi.fn(() => defs),
      execute: vi.fn(execute),
    }),
  } as unknown as Agent;
}

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// "none" is what a real local Claude Code subscription login reports — there is
// no API key involved. Verified against SDK 0.3.220.
const init = { type: "system", subtype: "init", apiKeySource: "none" };

function run(agent = makeAgent()) {
  return collect(runClaudeSdkEngine(agent, "claude-opus-4-8", [{ role: "user", content: "hi" }], "sys"));
}

beforeEach(() => {
  h.messages = [];
  h.lastOptions = undefined;
});

describe("runClaudeSdkEngine — event mapping", () => {
  it("streams text deltas live and takes the final text from assistant messages", async () => {
    h.messages = [
      init,
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "result", subtype: "success", result: "Hello", num_turns: 1 },
    ];

    const events = await run();

    expect(events.filter(e => e.type === "text")).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
    // Deltas are for the UI; the done payload must not double-count them.
    const done = events.find(e => e.type === "done");
    expect(done).toMatchObject({ result: { text: "Hello" } });
  });

  it("maps thinking deltas", async () => {
    h.messages = [
      init,
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] } },
      { type: "result", subtype: "success", result: "", num_turns: 1 },
    ];

    const events = await run();

    expect(events).toContainEqual({ type: "thinking", text: "hmm" });
    expect(events.find(e => e.type === "done")).toMatchObject({ result: { thinking: "hmm" } });
  });

  it("strips the mcp__squirl__ prefix from tool names", async () => {
    h.messages = [
      init,
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_1", name: "mcp__squirl__read_file", input: { path: "a.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "body" }] },
          ],
        },
      },
      { type: "result", subtype: "success", result: "", num_turns: 2 },
    ];

    const events = await run();

    // Squirl's renderer, redactToolArgs and the persisted rows all key on bare
    // ids — a leaked mcp__ prefix breaks all three silently.
    expect(events).toContainEqual({ type: "tool_start", name: "read_file", args: { path: "a.ts" } });
    expect(events).toContainEqual({ type: "tool_end", name: "read_file", result: "body", success: true });
  });

  it("marks an errored tool_result as unsuccessful", async () => {
    h.messages = [
      init,
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tu_1", name: "mcp__squirl__bash", input: {} }] },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }],
        },
      },
      { type: "result", subtype: "success", result: "", num_turns: 2 },
    ];

    const events = await run();

    expect(events).toContainEqual({ type: "tool_end", name: "bash", result: "boom", success: false });
  });

  it("refuses to run when a billed API key is in play", async () => {
    h.messages = [{ type: "system", subtype: "init", apiKeySource: "user" }];

    // Silently billing an API key when the user asked for subscription auth is
    // the failure mode this guards.
    await expect(run()).rejects.toThrow(/would bill it/i);
  });

  it.each(["none", "oauth"])("proceeds when apiKeySource is %s", async (source) => {
    h.messages = [
      { type: "system", subtype: "init", apiKeySource: source },
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
      { type: "result", subtype: "success", result: "hi", num_turns: 1 },
    ];

    // Allow-listing "oauth" here is what broke every real subscription turn —
    // keyless sources must pass, including ones not in the declared union.
    const events = await run();
    expect(events.find(e => e.type === "done")).toMatchObject({ result: { text: "hi" } });
  });

  it("proceeds on an unknown future source rather than failing closed", async () => {
    h.messages = [
      { type: "system", subtype: "init", apiKeySource: "some-new-keyless-source" },
      { type: "result", subtype: "success", result: "", num_turns: 1 },
    ];

    await expect(run()).resolves.toBeDefined();
  });

  it("throws on a non-success result subtype", async () => {
    h.messages = [init, { type: "result", subtype: "error_max_turns" }];

    await expect(run()).rejects.toThrow(/error_max_turns/);
  });
});

describe("runClaudeSdkEngine — SDK options", () => {
  it("disables built-in tools and filesystem settings, and strips the API key", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-should-not-reach-subprocess";
    h.messages = [init, { type: "result", subtype: "success", result: "", num_turns: 1 }];

    await run(makeAgent([{ name: "read_file", description: "Read", parameters: {} }]));

    // tools: [] is what stops the model reaching Bash/Write outside Squirl's
    // approval and snapshot system.
    expect(h.lastOptions.tools).toEqual([]);
    // settingSources: [] keeps the user's own ~/.claude config out of the turn.
    expect(h.lastOptions.settingSources).toEqual([]);
    expect(h.lastOptions.allowedTools).toEqual(["mcp__squirl__read_file"]);
    expect(h.lastOptions.includePartialMessages).toBe(true);
    expect(h.lastOptions.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(h.lastOptions.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("squirl");

    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("strips the router namespace before handing the model id to the SDK", async () => {
    h.messages = [init, { type: "result", subtype: "success", result: "", num_turns: 1 }];

    await collect(
      runClaudeSdkEngine(
        makeAgent(),
        "claude_subscription/claude-opus-4-8",
        [{ role: "user", content: "hi" }],
        "sys",
      ),
    );

    // `claude_subscription/` is Squirl's routing key, not a model id.
    expect(h.lastOptions.model).toBe("claude-opus-4-8");
  });

  it("passes Squirl's system prompt through verbatim", async () => {
    h.messages = [init, { type: "result", subtype: "success", result: "", num_turns: 1 }];

    await run();

    expect(h.lastOptions.systemPrompt).toBe("sys");
  });
});
