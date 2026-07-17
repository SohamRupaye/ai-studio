import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry, ToolVetoError } from "../registry.js";
import type { ToolContext, ToolDefinition, ToolResult, ToolFilterContext } from "../registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: "s1",
    messageId: "m1",
    agent: "test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  };
}

function makeStringDef(id: string): ToolDefinition {
  return {
    id,
    description: `Tool ${id}`,
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  };
}

async function okExecutor(_args: unknown, _ctx: ToolContext): Promise<ToolResult> {
  return { title: "ok", output: "success" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  const ctx = makeCtx();

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // --- Registration ---

  it("register + has returns true; ids() includes it", () => {
    registry.register(makeStringDef("foo"), okExecutor);
    expect(registry.has("foo")).toBe(true);
    expect(registry.ids()).toContain("foo");
  });

  it("unregister makes has() return false", () => {
    registry.register(makeStringDef("foo"), okExecutor);
    registry.unregister("foo");
    expect(registry.has("foo")).toBe(false);
  });

  it("getDefinition returns the registered definition", () => {
    const def = makeStringDef("bar");
    registry.register(def, okExecutor);
    const returned = registry.getDefinition("bar");
    expect(returned).toBeDefined();
    expect(returned!.id).toBe("bar");
    expect(returned!.description).toBe("Tool bar");
  });

  // --- Legacy registration ---

  it("legacy {name,...} registration works: has(name) is true", () => {
    registry.register(
      { name: "legacy", description: "Legacy tool", parameters: { type: "object", properties: {}, required: [] } },
      async (_args: Record<string, unknown>) => "done",
    );
    expect(registry.has("legacy")).toBe(true);
  });

  // --- Unknown tool ---

  it("execute unknown tool returns error result without throwing", async () => {
    const result = await registry.execute("nonexistent", {}, ctx);
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toMatch(/Unknown tool/i);
  });

  // --- Schema validation ---

  it("execute with missing required arg returns validation result", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    const result = await registry.execute("foo", {}, ctx);
    expect(result.metadata?.error).toBe(true);
    expect(result.metadata?.validation).toBe(true);
  });

  it("execute with wrong-type arg returns validation result", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    const result = await registry.execute("foo", { value: 42 }, ctx);
    expect(result.metadata?.error).toBe(true);
    expect(result.metadata?.validation).toBe(true);
  });

  it("execute with enum mismatch returns validation result", async () => {
    const def: ToolDefinition = {
      id: "enumtool",
      description: "Enum tool",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["a", "b"] } },
        required: ["mode"],
      },
    };
    registry.register(def, okExecutor);
    const result = await registry.execute("enumtool", { mode: "c" }, ctx);
    expect(result.metadata?.validation).toBe(true);
  });

  // --- Successful execution ---

  it("execute with valid args calls executor and returns its result", async () => {
    const executor = vi.fn(async (_args: unknown, _ctx: ToolContext): Promise<ToolResult> => ({
      title: "done",
      output: "hello from executor",
    }));
    registry.register(makeStringDef("foo"), executor);
    const result = await registry.execute("foo", { value: "test" }, ctx);
    expect(executor).toHaveBeenCalledOnce();
    expect(result.output).toBe("hello from executor");
  });

  // --- Events ---

  it('execute emits "tool_executed" event on success', async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    const listener = vi.fn();
    registry.on("tool_executed", listener);
    await registry.execute("foo", { value: "x" }, ctx);
    expect(listener).toHaveBeenCalledOnce();
    const span = listener.mock.calls[0]![0];
    expect(span.toolId).toBe("foo");
    expect(span.success).toBe(true);
  });

  it('execute emits "tool_error" event when executor throws', async () => {
    registry.register(makeStringDef("foo"), async () => {
      throw new Error("boom");
    });
    const listener = vi.fn();
    registry.on("tool_error", listener);
    await registry.execute("foo", { value: "x" }, ctx);
    expect(listener).toHaveBeenCalledOnce();
    const span = listener.mock.calls[0]![0];
    expect(span.success).toBe(false);
    expect(span.error).toMatch(/boom/);
  });

  // --- Before hook ---

  it("onBeforeExecute hook can modify args and executor sees modified value", async () => {
    const received: unknown[] = [];
    const executor = vi.fn(async (args: unknown, _ctx: ToolContext): Promise<ToolResult> => {
      received.push(args);
      return { title: "", output: "ok" };
    });
    registry.register(makeStringDef("foo"), executor);
    registry.onBeforeExecute((_toolId, args) => {
      return { ...(args as Record<string, unknown>), value: "modified" };
    });
    await registry.execute("foo", { value: "original" }, ctx);
    expect((received[0] as Record<string, unknown>)["value"]).toBe("modified");
  });

  it("onBeforeExecute hook can veto via ToolVetoError — executor never runs, result is a vetoed error", async () => {
    const executor = vi.fn(okExecutor);
    registry.register(makeStringDef("foo"), executor);
    registry.onBeforeExecute(() => {
      throw new ToolVetoError("User declined this tool call.");
    });
    const result = await registry.execute("foo", { value: "x" }, ctx);
    expect(executor).not.toHaveBeenCalled();
    expect(result.output).toBe("User declined this tool call.");
    expect(result.metadata?.error).toBe(true);
    expect(result.metadata?.vetoed).toBe(true);
  });

  it("veto in one call does not affect the next (per-call decision)", async () => {
    const executor = vi.fn(okExecutor);
    registry.register(makeStringDef("foo"), executor);
    let deny = true;
    registry.onBeforeExecute(() => {
      if (deny) throw new ToolVetoError("denied");
    });
    await registry.execute("foo", { value: "x" }, ctx);
    deny = false;
    const result = await registry.execute("foo", { value: "x" }, ctx);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.output).toBe("success");
  });

  // --- After hook ---

  it("onAfterExecute hook can modify result output", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    registry.onAfterExecute((_toolId, result) => ({
      ...result,
      output: result.output + " [modified]",
    }));
    const result = await registry.execute("foo", { value: "x" }, ctx);
    expect(result.output).toBe("success [modified]");
  });

  // --- Truncation ---

  it("setTruncation with maxOutputLength:10, strategy:tail truncates long output", async () => {
    registry.setTruncation({ maxOutputLength: 10, strategy: "tail" });
    registry.register(makeStringDef("foo"), async () => ({
      title: "big",
      output: "a".repeat(200),
    }));
    const result = await registry.execute("foo", { value: "x" }, ctx);
    expect(result.metadata?.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(200);
    expect(result.output).toMatch(/\[truncated\]/);
  });

  // --- Spans ---

  it("getSpans() accumulates after executions; clearSpans() empties", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    await registry.execute("foo", { value: "x" }, ctx);
    await registry.execute("foo", { value: "y" }, ctx);
    expect(registry.getSpans().length).toBe(2);
    registry.clearSpans();
    expect(registry.getSpans().length).toBe(0);
  });

  // --- getTools ---

  it("getTools() returns all registered tools", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    registry.register(makeStringDef("bar"), okExecutor);
    const tools = await registry.getTools();
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("foo");
    expect(ids).toContain("bar");
  });

  it("getTools({agentPermissions:{deny:['foo']}}) excludes denied tool", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    registry.register(makeStringDef("bar"), okExecutor);
    const filterCtx: ToolFilterContext = { agent: "test", agentPermissions: { deny: ["foo"] } };
    const tools = await registry.getTools(filterCtx);
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("foo");
    expect(ids).toContain("bar");
  });

  it("getTools with agentPermissions.allow restricts to allowed tools only", async () => {
    registry.register(makeStringDef("foo"), okExecutor);
    registry.register(makeStringDef("bar"), okExecutor);
    const filterCtx: ToolFilterContext = { agent: "test", agentPermissions: { allow: ["bar"] } };
    const tools = await registry.getTools(filterCtx);
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("foo");
    expect(ids).toContain("bar");
  });

  // --- dynamicDescription ---

  it("register with dynamicDescription appends dynamic text in getTools(ctx)", async () => {
    const def: ToolDefinition = {
      id: "dynamic",
      description: "Base description.",
      parameters: { type: "object", properties: {}, required: [] },
      dynamicDescription: (_ctx) => "Dynamic text appended.",
    };
    registry.register(def, okExecutor);
    const filterCtx: ToolFilterContext = { agent: "test" };
    const tools = await registry.getTools(filterCtx);
    const tool = tools.find((t) => t.id === "dynamic");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Base description.");
    expect(tool!.description).toContain("Dynamic text appended.");
  });
});
