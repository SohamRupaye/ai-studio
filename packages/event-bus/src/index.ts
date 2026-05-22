import type { Branch, Organisation, Project, Chat } from "@ai-studio/shared";

// ── Types used in IPC (defined here to avoid circular deps) ──────────────────

export interface MemoryFact {
  id: number;
  text: string;
  scope: string;
  createdAt: number;
}

export interface BranchDiff {
  onlyInA: Array<{ topic: string; decision: string; turn: number }>;
  onlyInB: Array<{ topic: string; decision: string; turn: number }>;
  shared: Array<{ topic: string; decisionA: string; decisionB: string }>;
  commonAncestor?: string;
}

// ── Agent stream events pushed from main → renderer ──────────────────────────

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string; success: boolean }
  | { type: "tool_call_streaming"; name: string; bytesReceived: number }
  | { type: "done"; text: string; iterations: number; cost?: string }
  | { type: "error"; message: string };

// ── IPC invoke channels: renderer → main (request/response) ──────────────────

export interface IpcInvokeMap {
  // Chat
  "chat:send": [{ branchId: string; message: string }, void];
  "chat:abort": [void, void];

  // Organisations
  "org:list": [void, Organisation[]];
  "org:create": [{ name: string }, Organisation];

  // Projects
  "project:list": [{ orgId: string }, Project[]];
  "project:create": [{ orgId: string; name: string }, Project];

  // Chats
  "chat:list": [{ projectId: string }, Chat[]];
  "chat:create": [{ projectId: string; name: string }, Chat];

  // Branches
  "branch:list": [void, Branch[]];
  "branch:create": [{ name: string; model: string; parentId?: string; forkAtIndex?: number; chatId?: string }, Branch];
  "branch:delete": [{ id: string }, boolean];
  "branch:switch": [{ id: string }, void];
  "branch:rename": [{ id: string; name: string }, void];
  "branch:pin-add": [{ branchId: string; text: string }, void];
  "branch:pin-remove": [{ branchId: string; index: number }, boolean];
  "branch:compare": [{ branchIdA: string; branchIdB: string }, BranchDiff];

  // Messages
  "message:list": [{ branchId: string }, Array<{ role: string; content: string; turn: number }>];
  "message:undo": [{ branchId: string }, number];

  // Artifacts
  "artifact:list": [{ projectId: string }, Array<{ id: string; type: string; title: string; version: number }>];
  "artifact:get": [{ id: string }, { id: string; type: string; title: string; content: string; version: number } | null];
  "artifact:update": [{ id: string; content: string; title?: string }, void];

  // Memory
  "memory:list": [{ scope?: string }, MemoryFact[]];
  "memory:add": [{ text: string; scope: string }, MemoryFact];
  "memory:remove": [{ id: number }, boolean];

  // Models
  "models:list": [void, Record<string, string[]>];

  // User
  "user:get": [void, { id: string; name: string } | null];
  "user:set": [{ name: string; email?: string }, { id: string; name: string }];

  // Config
  "config:get": [void, Record<string, unknown>];
  "config:set": [Record<string, unknown>, void];

  // Costs
  "costs:branch": [{ branchId: string }, Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; timestamp: number }>];
  "costs:project": [{ projectId: string }, { totalCost: number; totalInput: number; totalOutput: number }];
}

// ── IPC event channels: main → renderer (one-way push) ───────────────────────

export interface IpcEventMap {
  "chat:stream": AgentStreamEvent;
  "app:ready": { version: string };
}

// ── Channel name helpers ──────────────────────────────────────────────────────

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

export type IpcInvokeRequest<C extends IpcInvokeChannel> = IpcInvokeMap[C][0];
export type IpcInvokeResponse<C extends IpcInvokeChannel> = IpcInvokeMap[C][1];
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C];
