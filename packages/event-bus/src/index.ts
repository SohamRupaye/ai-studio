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

// ── MCP servers ────────────────────────────────────────────────────────────────

export type MCPTransport = "stdio" | "sse" | "http";

export interface MCPServerConfigInput {
  name: string;
  type: MCPTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export type MCPStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth"; url?: string }
  | { status: "reconnecting"; attempt: number };

export interface MCPServerEntry {
  config: MCPServerConfigInput;
  status: MCPStatus;
  tools: Array<{ name: string; description?: string }>;
}

// ── Skills ─────────────────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string;
  description: string;
  tools: string[];
}

// ── Permissions ─────────────────────────────────────────────────────────────────

export interface PermissionRuleInfo {
  tool: string;
  pattern?: string;
  decision: "allow" | "deny";
  scope: "global" | "project" | "session";
  createdAt: number;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotInfo {
  id: string;
  sessionId: string;
  files: Array<{ path: string; action: "restore" | "delete" }>;
  createdAt: number;
  description?: string;
}

// ── Personas ─────────────────────────────────────────────────────────────────

export interface PersonaInfo {
  name: string;
  description?: string;
  model?: string;
  allowedTools?: string[];
  deniedTools?: string[];
}

// ── Knowledge base ─────────────────────────────────────────────────────────────

export interface KnowledgeEntryInfo {
  id: number;
  title: string;
  content: string;
  tags: string[];
  category: "architecture" | "style" | "api" | "gotcha" | "decision" | "note";
  createdAt: number;
  updatedAt: number;
}

// ── Agent stream events pushed from main → renderer ──────────────────────────

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string; success: boolean }
  | { type: "tool_call_streaming"; name: string; bytesReceived: number }
  | { type: "done"; text: string; iterations: number; cost?: string }
  | { type: "error"; message: string; turn?: number; rateLimited?: boolean; retryAfterSeconds?: number };

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
  "branch:update-model": [{ id: string; model: string }, void];
  "branch:pin-add": [{ branchId: string; text: string }, void];
  "branch:pin-remove": [{ branchId: string; index: number }, boolean];
  "branch:compare": [{ branchIdA: string; branchIdB: string }, BranchDiff];

  // Messages
  "message:list": [{ branchId: string }, Array<{ id: string; role: string; content: string; turn: number; timestamp: number }>];
  "message:undo": [{ branchId: string }, number];
  "message:edit": [{ branchId: string; turn: number }, void];
  "message:delete": [{ branchId: string; turn: number }, number];

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

  // Codex OAuth account
  "codex:status": [void, { connected: boolean; accountId?: string; email?: string }];
  "codex:login": [void, { connected: boolean; accountId?: string; email?: string }];
  "codex:logout": [void, void];
  "codex:switch-account": [void, { connected: boolean; accountId?: string; email?: string }];

  // User
  "user:get": [void, { id: string; name: string } | null];
  "user:set": [{ name: string; email?: string }, { id: string; name: string }];

  // Config
  "config:get": [void, Record<string, unknown>];
  "config:set": [Record<string, unknown>, void];

  // Costs
  "costs:branch": [{ branchId: string }, Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; timestamp: number }>];
  "costs:project": [{ projectId: string }, { totalCost: number; totalInput: number; totalOutput: number }];

  // MCP servers
  "mcp:list": [void, MCPServerEntry[]];
  "mcp:add": [MCPServerConfigInput, MCPServerEntry];
  "mcp:remove": [{ name: string }, void];
  "mcp:reconnect": [{ name: string }, MCPServerEntry];

  // Skills
  "skills:list": [void, SkillSummary[]];

  // Permissions
  "permissions:list": [void, PermissionRuleInfo[]];
  "permissions:remove": [{ tool: string; pattern?: string }, boolean];
  "permissions:clear": [void, void];

  // Snapshots (per-branch, keyed by branchId as sessionId)
  "snapshot:list": [{ branchId: string }, SnapshotInfo[]];
  "snapshot:diff": [{ snapshotId: string }, Array<{ path: string; action: "restore" | "delete" }>];
  "snapshot:revert": [{ snapshotId: string }, { reverted: string[]; errors: string[] }];

  // Personas
  "persona:list": [void, PersonaInfo[]];
  "persona:get-active": [{ branchId: string }, string];
  "persona:set-active": [{ branchId: string; name: string }, void];

  // Knowledge base
  "kb:list": [{ category?: string; tags?: string[] }, KnowledgeEntryInfo[]];
  "kb:search": [{ query: string; category?: string; tags?: string[] }, KnowledgeEntryInfo[]];
  "kb:add": [{ title: string; content: string; category?: KnowledgeEntryInfo["category"]; tags?: string[] }, KnowledgeEntryInfo];
  "kb:remove": [{ id: number }, boolean];
}

// ── IPC event channels: main → renderer (one-way push) ───────────────────────

export interface IpcEventMap {
  "chat:stream": AgentStreamEvent;
  "app:ready": { version: string };
  /** Fired after a background model-list refresh completes, so the renderer
   * can refetch models:list without polling. */
  "models:refreshed": void;
}

// ── Channel name helpers ──────────────────────────────────────────────────────

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

export type IpcInvokeRequest<C extends IpcInvokeChannel> = IpcInvokeMap[C][0];
export type IpcInvokeResponse<C extends IpcInvokeChannel> = IpcInvokeMap[C][1];
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C];
