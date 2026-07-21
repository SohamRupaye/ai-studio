import { describe, it, expect, vi } from "vitest";
import type { Router } from "@squirl/providers";
import { createDefaultRegistry } from "@squirl/tools-runtime";
import type { ToolContext } from "@squirl/tools-runtime";
import { applySubagentEvent, newSubagentRecord } from "@squirl/shared";
import { createRuntime, type SubagentEvent } from "../runtime.js";

// Regression: createRuntime used to set a PRIVATE ai-core copy of the
// subagent dependencies while the registered subagent/delegate tools read
// tools-runtime's module state — so every delegation call errored
// "dependencies not initialized" and multi-model fan-out was dead.

function makeRouter(): Router {
  return {
    call: vi.fn(),
    // Echo the model so tests can assert which model each subagent ran on.
    stream: vi.fn(function (model: string) {
      return (async function* () {
        yield { type: "text", text: `ran on ${model}` };
      })();
    }),
  } as unknown as Router;
}

const ctx: ToolContext = {
  sessionId: "test",
  messageId: "test",
  agent: "test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
};

describe("createRuntime → subagent tool wiring", () => {
  it("plugs the task runner into the REGISTERED subagent tool (not a private copy)", async () => {
    const registry = createDefaultRegistry();
    const router = makeRouter();
    createRuntime(router, registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "do the thing" }] },
      ctx,
    );

    expect(result.output).not.toContain("not initialized");
    expect(result.output).toContain("ran on branch-model");
  });

  it("runs each delegated task on its own model, defaulting to the current one", async () => {
    const registry = createDefaultRegistry();
    const router = makeRouter();
    createRuntime(router, registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      {
        tasks: [
          { id: "cheap", task: "summarize", model: "haiku-mini" },
          { id: "default", task: "analyze" },
        ],
      },
      ctx,
    );

    expect(result.output).toContain("ran on haiku-mini");
    expect(result.output).toContain("ran on branch-model");
  });

  it("delegate starts a background job that delegate_result can collect", async () => {
    const registry = createDefaultRegistry();
    const router = makeRouter();
    createRuntime(router, registry, "branch-model");

    const started = await registry.execute(
      "delegate",
      { task: "long job", job_id: "job-1" },
      ctx,
    );
    expect(started.output).toContain("started");
    expect(started.output).not.toContain("not initialized");

    // The fake router resolves immediately; give the fire-and-forget
    // promise chain a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await registry.execute("delegate_result", { job_id: "job-1" }, ctx);
    expect(result.output).toContain("completed");
    expect(result.output).toContain("ran on branch-model");
  });
});

// The delegating model routinely invents model ids ("current",
// "gpt-4.1-mini") — an unknown model must degrade to the chat's own model
// with a visible note, not kill the whole delegation.
function makeStrictRouter(known: string[]): Router {
  return {
    call: vi.fn(),
    stream: vi.fn(function (model: string) {
      if (!known.includes(model)) throw new Error(`No provider for model: ${model}.`);
      return (async function* () {
        yield { type: "text", text: `ran on ${model}` };
      })();
    }),
  } as unknown as Router;
}

describe("createRuntime → unknown-model fallback", () => {
  it("falls back to the chat's model when the requested model has no provider", async () => {
    const registry = createDefaultRegistry();
    createRuntime(makeStrictRouter(["branch-model"]), registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "assess risk", model: "gpt-4.1-mini" }] },
      ctx,
    );

    expect(result.output).not.toContain("Failed:");
    expect(result.output).toContain("ran on branch-model");
    // The fallback is announced, not silent.
    expect(result.output).toContain('"gpt-4.1-mini" isn\'t available here');
  });

  it("valid model overrides still route as requested (no fallback)", async () => {
    const registry = createDefaultRegistry();
    createRuntime(makeStrictRouter(["branch-model", "haiku-mini"]), registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "summarize", model: "haiku-mini" }] },
      ctx,
    );

    expect(result.output).toContain("ran on haiku-mini");
    expect(result.output).not.toContain("isn't available here");
  });

  it("still reports failure when even the default model has no provider", async () => {
    const registry = createDefaultRegistry();
    createRuntime(makeStrictRouter([]), registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "anything" }] },
      ctx,
    );

    expect(result.output).toContain("Failed:");
    expect(result.output).toContain("No provider for model");
  });

  it("non-model errors are not swallowed by the fallback path", async () => {
    const registry = createDefaultRegistry();
    const router = {
      call: vi.fn(),
      stream: vi.fn(() => { throw new Error("rate limited"); }),
    } as unknown as Router;
    createRuntime(router, registry, "branch-model");

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "anything", model: "other-model" }] },
      ctx,
    );

    expect(result.output).toContain("Failed: rate limited");
  });
});

describe("createRuntime → per-agent lifecycle events", () => {
  it("emits start → done with run/agent identity; fallback re-announces the model", async () => {
    const registry = createDefaultRegistry();
    const events: SubagentEvent[] = [];
    createRuntime(makeStrictRouter(["branch-model"]), registry, "branch-model", (e) => events.push(e));

    await registry.execute(
      "subagent",
      { tasks: [{ id: "risk", task: "assess risk", model: "bogus-model" }] },
      ctx,
    );

    const starts = events.filter((e) => e.status === "start");
    expect(starts.map((s) => s.model)).toEqual(["bogus-model", "branch-model"]);
    expect(starts[0]!.agentId).toBe("risk");
    expect(starts[0]!.task).toBe("assess risk");

    // The agent's own text streams as transcript events.
    const texts = events.filter((e) => e.status === "text");
    expect(texts.map((t) => t.text).join("")).toContain("ran on branch-model");

    const done = events.find((e) => e.status === "done");
    expect(done?.result).toContain("ran on branch-model");
    // All events of one delegation share a runId.
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
  });

  it("kills a run that produces no result within its timeout", async () => {
    const registry = createDefaultRegistry();
    // A provider that streams forever and ignores the abort signal — the
    // event-loop backstop must still kill the run.
    const router = {
      call: vi.fn(),
      stream: vi.fn(function () {
        return (async function* () {
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            yield { type: "text", text: "still going" };
          }
        })();
      }),
    } as unknown as Router;
    const events: SubagentEvent[] = [];
    const { runTask } = createRuntime(router, registry, "branch-model", (e) => events.push(e));

    await expect(
      runTask("never finish", "branch-model", "", undefined, { runId: "r1", agentId: "slow", timeoutMs: 100 }),
    ).rejects.toThrow(/Timed out/);

    const failed = events.find((e) => e.status === "failed");
    expect(failed?.error).toMatch(/Timed out/);
  });

  // Regression: runTask used to build its own AbortController with zero link
  // to the turn that spawned it — the composer's Stop button killed the
  // visible stream but left a parallel `subagent` task running invisibly,
  // server-side, until its own 5-minute timeout.
  it("cascades a parent-turn abort into a task opted in via cascadeParentAbort", async () => {
    const registry = createDefaultRegistry();
    const router = {
      call: vi.fn(),
      stream: vi.fn(function () {
        return (async function* () {
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            yield { type: "text", text: "still going" };
          }
        })();
      }),
    } as unknown as Router;
    const events: SubagentEvent[] = [];
    const parent = new AbortController();
    const { runTask } = createRuntime(router, registry, "branch-model", (e) => events.push(e), parent.signal);

    const task = runTask("never finish", "branch-model", "", undefined, {
      runId: "r1",
      agentId: "blocking",
      timeoutMs: 10_000, // long — only the parent abort should end this
      cascadeParentAbort: true,
    });
    setTimeout(() => parent.abort(), 30);

    await expect(task).rejects.toThrow(/Cancelled — the turn was stopped/);
    const failed = events.find((e) => e.status === "failed");
    expect(failed?.error).toMatch(/Cancelled/);
  });

  it("does NOT cascade a parent-turn abort into a task without cascadeParentAbort (delegate)", async () => {
    const registry = createDefaultRegistry();
    const router = {
      call: vi.fn(),
      stream: vi.fn(function () {
        return (async function* () {
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 15));
            yield { type: "text", text: "still going" };
          }
        })();
      }),
    } as unknown as Router;
    const parent = new AbortController();
    const { runTask } = createRuntime(router, registry, "branch-model", undefined, parent.signal);

    const task = runTask("background job", "branch-model", "", undefined, {
      runId: "r2",
      agentId: "background",
      timeoutMs: 150, // short own timeout — should be what actually ends this
    });
    parent.abort(); // fires immediately, before the task even starts looping

    // Still running well past when a cascade would have killed it instantly.
    const stillPending = await Promise.race([
      task.then(() => "settled").catch(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 60)),
    ]);
    expect(stillPending).toBe("pending");

    // Its own timeout still applies — this isn't immune to ever stopping.
    await expect(task).rejects.toThrow(/Timed out/);
  });

  it("parallel tasks get distinct agentIds under one runId; failures emit failed", async () => {
    const registry = createDefaultRegistry();
    const events: SubagentEvent[] = [];
    createRuntime(makeStrictRouter([]), registry, "", (e) => events.push(e));

    await registry.execute(
      "subagent",
      { tasks: [{ id: "a", task: "one" }, { task: "two" }] },
      ctx,
    );

    const failed = events.filter((e) => e.status === "failed");
    expect(failed.map((f) => f.agentId).sort()).toEqual(["a", "task-2"]);
    expect(failed[0]!.error).toContain("No provider for model");
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
  });

  it("applySubagentEvent builds the transcript main persists and the drawer renders", () => {
    // The shared reducer is the single source of truth for trail-building —
    // main (persistence) and the renderer (live drawer) both fold the same
    // event stream through it.
    const rec = newSubagentRecord("risk");
    const base = { runId: "r1", agentId: "risk" } as const;

    applySubagentEvent(rec, { ...base, status: "start", task: "assess", model: "m1" });
    applySubagentEvent(rec, { ...base, status: "text", text: "Let me " });
    applySubagentEvent(rec, { ...base, status: "text", text: "check." });
    applySubagentEvent(rec, { ...base, status: "tool", tool: "web_search", args: '{"q":"x"}' });
    applySubagentEvent(rec, { ...base, status: "tool_end", tool: "web_search", success: true, resultPreview: "3 hits" });
    applySubagentEvent(rec, { ...base, status: "text", text: "Found it." });
    applySubagentEvent(rec, { ...base, status: "done", result: "Let me check.\n\nFound it." });

    expect(rec.status).toBe("done");
    expect(rec.steps).toEqual([
      { type: "text", text: "Let me check." },     // consecutive deltas merge
      { type: "tool", tool: "web_search", args: '{"q":"x"}', success: true, resultPreview: "3 hits" },
      { type: "text", text: "Found it." },          // tool call splits segments
    ]);
  });

  it("an observer that throws never kills the run", async () => {
    const registry = createDefaultRegistry();
    createRuntime(makeStrictRouter(["branch-model"]), registry, "branch-model", () => {
      throw new Error("observer bug");
    });

    const result = await registry.execute(
      "subagent",
      { tasks: [{ id: "t1", task: "do it" }] },
      ctx,
    );

    expect(result.output).toContain("ran on branch-model");
  });
});
