import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolHandler } from "../../registry.js";
import type { ToolDefinition } from "../../types.js";

// ---------------------------------------------------------------------------
// Module-level state isolation strategy:
// The todos array and nextId in todo.ts are module-level. Vitest caches
// modules between tests by default. We use vi.resetModules() + dynamic import
// in beforeEach so each test starts with a fresh module (empty todos, nextId=1).
// ---------------------------------------------------------------------------

let todoCreate: ToolHandler;
let todoComplete: ToolHandler;
let todoList: ToolHandler;
let todoCreateDef: ToolDefinition;
let todoCompleteDef: ToolDefinition;
let todoListDef: ToolDefinition;

beforeEach(async () => {
  vi.resetModules();
  const m = await import("../../tools/todo.js");
  todoCreate = m.todoCreate;
  todoComplete = m.todoComplete;
  todoList = m.todoList;
  todoCreateDef = m.todoCreateDef;
  todoCompleteDef = m.todoCompleteDef;
  todoListDef = m.todoListDef;
});

// ---------------------------------------------------------------------------
// Definition names
// ---------------------------------------------------------------------------

describe("todo definition names", () => {
  it('todoCreateDef.name is "todo_create"', () => {
    expect(todoCreateDef.name).toBe("todo_create");
  });

  it('todoCompleteDef.name is "todo_complete"', () => {
    expect(todoCompleteDef.name).toBe("todo_complete");
  });

  it('todoListDef.name is "todo_list"', () => {
    expect(todoListDef.name).toBe("todo_list");
  });
});

// ---------------------------------------------------------------------------
// todoList on empty state
// ---------------------------------------------------------------------------

describe("todoList on empty state", () => {
  it('returns "No todos."', async () => {
    const result = await todoList({});
    expect(result).toBe("No todos.");
  });
});

// ---------------------------------------------------------------------------
// todoCreate
// ---------------------------------------------------------------------------

describe("todoCreate", () => {
  it('returns a string containing "Created todo #" and the text', async () => {
    const result = await todoCreate({ text: "write tests" });
    expect(result).toMatch(/Created todo #/);
    expect(result).toMatch(/write tests/);
  });

  it("assigns sequential IDs starting from 1", async () => {
    const r1 = await todoCreate({ text: "first" });
    const r2 = await todoCreate({ text: "second" });
    expect(r1).toMatch(/#1/);
    expect(r2).toMatch(/#2/);
  });
});

// ---------------------------------------------------------------------------
// todoList after creates
// ---------------------------------------------------------------------------

describe("todoList after creating items", () => {
  it('shows "○" (pending marker) and the item text', async () => {
    await todoCreate({ text: "write tests" });
    const result = await todoList({});
    expect(result).toMatch(/○/);
    expect(result).toMatch(/write tests/);
  });

  it("lists all created items", async () => {
    await todoCreate({ text: "first task" });
    await todoCreate({ text: "second task" });
    const result = await todoList({});
    expect(result).toMatch(/first task/);
    expect(result).toMatch(/second task/);
  });
});

// ---------------------------------------------------------------------------
// todoComplete
// ---------------------------------------------------------------------------

describe("todoComplete", () => {
  it('returns a string containing "Completed" when item exists', async () => {
    await todoCreate({ text: "write tests" });
    const result = await todoComplete({ id: 1 });
    expect(result).toMatch(/Completed/);
  });

  it("marks item as done — todoList shows ✓ after completing", async () => {
    await todoCreate({ text: "write tests" });
    await todoComplete({ id: 1 });
    const list = await todoList({});
    expect(list).toMatch(/✓/);
  });

  it('returns "not found" message for unknown id', async () => {
    const result = await todoComplete({ id: 999 });
    expect(result).toMatch(/not found/i);
  });

  it("completed item still appears in list with ✓ marker", async () => {
    await todoCreate({ text: "important task" });
    await todoComplete({ id: 1 });
    const list = await todoList({});
    expect(list).toMatch(/✓/);
    expect(list).toMatch(/important task/);
  });
});

// ---------------------------------------------------------------------------
// Mixed workflow
// ---------------------------------------------------------------------------

describe("mixed create/complete/list workflow", () => {
  it("pending and completed items coexist in list", async () => {
    await todoCreate({ text: "done task" });
    await todoCreate({ text: "pending task" });
    await todoComplete({ id: 1 });
    const list = await todoList({});
    expect(list).toMatch(/✓/);
    expect(list).toMatch(/○/);
    expect(list).toMatch(/done task/);
    expect(list).toMatch(/pending task/);
  });
});
