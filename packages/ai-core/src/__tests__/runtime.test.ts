import { describe, it, expect, vi } from "vitest";
import type { Router } from "@ai-studio/providers";
import { createDefaultRegistry } from "@ai-studio/tools-runtime";
import type { ToolContext } from "@ai-studio/tools-runtime";
import { createRuntime } from "../runtime.js";

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
