import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

interface TodoItem { id: number; text: string; done: boolean }
const todos: TodoItem[] = [];
let nextId = 1;

export const todoCreateDef: ToolDefinition = {
  name: "todo_create",
  description: "Create a new todo item for tracking multi-step work.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
export const todoCreate: ToolHandler = async (args) => {
  const item: TodoItem = { id: nextId++, text: args["text"] as string, done: false };
  todos.push(item);
  return `Created todo #${item.id}: ${item.text}`;
};

export const todoCompleteDef: ToolDefinition = {
  name: "todo_complete",
  description: "Mark a todo item as completed.",
  parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
};
export const todoComplete: ToolHandler = async (args) => {
  const item = todos.find(t => t.id === (args["id"] as number));
  if (!item) return `Todo #${args["id"]} not found`;
  item.done = true;
  return `Completed: #${item.id} ${item.text}`;
};

export const todoListDef: ToolDefinition = {
  name: "todo_list",
  description: "List all todo items with their status.",
  parameters: { type: "object", properties: {}, required: [] },
};
export const todoList: ToolHandler = async () => {
  if (!todos.length) return "No todos.";
  return todos.map(t => `${t.done ? "✓" : "○"} #${t.id} ${t.text}`).join("\n");
};
