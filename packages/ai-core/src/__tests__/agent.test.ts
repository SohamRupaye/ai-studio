import { describe, it, expect, vi } from "vitest";
import type { Router } from "@ai-studio/providers";
import type { ToolRegistry, ToolResult, ToolContext } from "@ai-studio/tools-runtime";
import { Agent, type AgentStreamEvent } from "../agent.js";
import { CostTracker } from "../costs.js";

type StreamScript = () => AsyncGenerator<any>;

function makeRouter(scripts: StreamScript[]): Router {
  let callIndex = 0;
  return {
    call: vi.fn(),
    stream: vi.fn(() => {
      const script = scripts[Math.min(callIndex, scripts.length - 1)]!;
      callIndex++;
      return script();
    }),
  } as unknown as Router;
}

function makeRegistry(
  execute: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> = async () => ({
    title: "",
    output: "ok",
  }),
): ToolRegistry {
  return {
    getDefinitions: vi.fn(() => []),
    execute: vi.fn(execute),
  } as unknown as ToolRegistry;
}

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function doneResult(events: AgentStreamEvent[]) {
  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") throw new Error("no done event");
  return done.result;
}

describe("Agent.run", () => {
  it("with no tool calls, yields text events then a single done with iterations: 1", async () => {
    const router = makeRouter([
      async function* () {
        yield { type: "text", text: "Hello" };
        yield { type: "text", text: " world" };
      },
    ]);
    const agent = new Agent(router, makeRegistry());

    const events = await collect(agent.run("model", [{ role: "user", content: "what tools do you have?" }], "sys"));

    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
    ]);
    const result = doneResult(events);
    expect(result.text).toBe("Hello world");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toEqual([]);
  });

  it("executes a tool call, appends the result to history, and continues to a second iteration", async () => {
    const execute = vi.fn(async (): Promise<ToolResult> => ({ title: "write", output: "wrote file" }));
    const registry = makeRegistry(execute);
    const router = makeRouter([
      async function* () {
        yield { type: "tool_call", id: "1", name: "write_file", arguments: { path: "a.ts" } };
      },
      async function* () {
        yield { type: "text", text: "I fixed the bug." };
      },
    ]);
    const agent = new Agent(router, registry);

    const events = await collect(agent.run("model", [{ role: "user", content: "fix the bug" }], "sys"));

    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end", "text", "done"]);
    expect(execute).toHaveBeenCalledWith("write_file", { path: "a.ts" }, expect.anything());
    const result = doneResult(events);
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toEqual([{ name: "write_file", args: { path: "a.ts" }, result: "wrote file", success: true }]);
    expect(result.text).toBe("I fixed the bug.");
  });

  it("respects maxIterations even if the model keeps requesting tools forever", async () => {
    const registry = makeRegistry(async () => ({ title: "", output: "ok" }));
    const router = makeRouter([
      async function* () {
        yield { type: "tool_call", id: "x", name: "bash", arguments: {} };
      },
    ]);
    const agent = new Agent(router, registry, { maxIterations: 3 });

    const events = await collect(agent.run("model", [{ role: "user", content: "run forever" }], "sys"));

    const result = doneResult(events);
    expect(result.iterations).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
  });

  describe("validateResponse guard", () => {
    it("forces a corrective retry when the model deflects on a requested action", async () => {
      const router = makeRouter([
        async function* () {
          yield { type: "text", text: "Would you like me to fix this now?" };
        },
        async function* () {
          yield { type: "text", text: "All set, done." };
        },
      ]);
      const agent = new Agent(router, makeRegistry(), { maxIterations: 5 });

      const events = await collect(agent.run("model", [{ role: "user", content: "please fix the login bug" }], "sys"));

      expect((router.stream as any).mock.calls).toHaveLength(2);
      const secondCallHistory = (router.stream as any).mock.calls[1][1];
      expect(secondCallHistory.some((m: any) => m.content.includes("Execute the change NOW using tools"))).toBe(true);
      const result = doneResult(events);
      expect(result.iterations).toBe(2);
      expect(result.text).toBe("All set, done.");
    });

    it("forces a corrective retry when the model claims a change with no write tool called", async () => {
      const router = makeRouter([
        async function* () {
          yield { type: "text", text: "I updated the config file successfully." };
        },
        async function* () {
          yield { type: "text", text: "Sure thing." };
        },
      ]);
      const agent = new Agent(router, makeRegistry());

      const events = await collect(agent.run("model", [{ role: "user", content: "please update the config file" }], "sys"));

      expect((router.stream as any).mock.calls).toHaveLength(2);
      const secondCallHistory = (router.stream as any).mock.calls[1][1];
      expect(secondCallHistory.some((m: any) => m.content.includes("This is a hallucination"))).toBe(true);
      const result = doneResult(events);
      expect(result.iterations).toBe(2);
      expect(result.text).toBe("Sure thing.");
    });

    it("does not fire for a plain informational question", async () => {
      const router = makeRouter([
        async function* () {
          yield { type: "text", text: "We have access to file, git, and web search tools." };
        },
      ]);
      const agent = new Agent(router, makeRegistry());

      const events = await collect(agent.run("model", [{ role: "user", content: "what tools do you have available?" }], "sys"));

      expect((router.stream as any).mock.calls).toHaveLength(1);
      const result = doneResult(events);
      expect(result.iterations).toBe(1);
      expect(result.text).toBe("We have access to file, git, and web search tools.");
    });
  });

  it("records cost from usage events and reflects it on the done result", async () => {
    const router = makeRouter([
      async function* () {
        yield { type: "usage", usage: { input_tokens: 1000, output_tokens: 500 } };
        yield { type: "text", text: "Here's the answer." };
      },
    ]);
    const costTracker = new CostTracker();
    const agent = new Agent(router, makeRegistry(), { costTracker });

    const events = await collect(agent.run("claude-sonnet-4", [{ role: "user", content: "what's 2+2?" }], "sys"));

    expect(costTracker.totalCost).toBeCloseTo(0.0105, 8);
    const result = doneResult(events);
    expect(result.cost).toBe(costTracker.lastCost());
    expect(result.cost).not.toBe("");
  });

  it("passes the run's abort signal through to the tool context", async () => {
    let capturedCtx: ToolContext | undefined;
    const registry = makeRegistry(async (_name, _args, ctx) => {
      capturedCtx = ctx;
      return { title: "", output: "ok" };
    });
    const router = makeRouter([
      async function* () {
        yield { type: "tool_call", id: "1", name: "bash", arguments: {} };
      },
      async function* () {
        yield { type: "text", text: "Done." };
      },
    ]);
    const controller = new AbortController();
    const agent = new Agent(router, registry, { sessionId: "s1", messageId: "m1", agent: "coder" });

    await collect(agent.run("model", [{ role: "user", content: "run it" }], "sys", controller.signal));

    expect(capturedCtx?.abort).toBe(controller.signal);
    expect(capturedCtx?.sessionId).toBe("s1");
    expect(capturedCtx?.messageId).toBe("m1");
    expect(capturedCtx?.agent).toBe("coder");
  });
});
