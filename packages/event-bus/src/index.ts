import type { Branch, Organisation, Project, Space, Chat, MessageImage } from "@ai-studio/shared";

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

// ── Context inspector (right panel) ───────────────────────────────────────────

/** What the model saw on this branch's last completed turn. Captured by
 * chat:send when it assembles the payload and persisted — deliberately never
 * recomputed on demand, because a payload dry-run can spend tokens
 * (ancestry compression calls the model, retrieval runs embeddings). */
export interface ContextStats {
  model: string;
  tokenEstimate: number;
  contextLimit: number;
  /** Inherited parent-branch messages in context. */
  tierAncestry: number;
  /** Compacted summaries of this conversation's older turns. */
  tierWarm: number;
  /** Knowledge-graph entries retrieved for the last message. */
  tierRetrieved: number;
  /** Recent turns sent verbatim. */
  tierHot: number;
  /** Tokens the <selected_artifacts> block contributed (0 when none) — the
   * baseline the panel adjusts when the user changes the selection. */
  artifactTokens: number;
  capturedAt: number;
}

/** One artifact row in the right panel's selectable list. */
export interface SelectableArtifact {
  id: string;
  type: string;
  title: string;
  version: number;
  updatedAt: number;
  /** Estimated tokens this artifact adds to context when selected. */
  tokens: number;
  /** Whether it was extracted on the branch being inspected. */
  fromThisBranch: boolean;
  /** 'extracted' (from an agent reply) or 'upload' (a user-attached file). */
  source: string;
}

// ── Agent stream events pushed from main → renderer ──────────────────────────

// Every variant carries the branchId it belongs to — main runs one agent
// turn at a time but the renderer may have navigated to a different branch
// (or a different branch's page may remount) before it resolves, so each
// event must self-identify rather than relying on "whichever page is open".
export type AgentStreamEvent =
  | { type: "text"; branchId: string; text: string }
  | { type: "tool_start"; branchId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; branchId: string; name: string; result: string; success: boolean }
  | { type: "tool_call_streaming"; branchId: string; name: string; bytesReceived: number }
  | { type: "done"; branchId: string; text: string; iterations: number; cost?: string }
  | { type: "error"; branchId: string; message: string; turn?: number; rateLimited?: boolean; retryAfterSeconds?: number };

// ── IPC invoke channels: renderer → main (request/response) ──────────────────

export interface IpcInvokeMap {
  // Chat
  "chat:send": [{ branchId: string; message: string; images?: MessageImage[] }, void];
  "chat:abort": [void, void];
  /** Copy images into data/blobs (downscaling oversized PNG/JPEG to fit
   * provider limits) and return references to attach to the next message,
   * plus per-file reasons for anything skipped. With `paths` (drag-drop) the
   * given files are staged directly; without, a native picker opens. Both
   * arrays empty if cancelled. */
  "image:stage": [
    { branchId: string; paths?: string[] },
    { staged: MessageImage[]; skipped: Array<{ filename: string; reason: string }> },
  ];
  /** Stage images from raw bytes — pasted bitmaps and drags with no backing
   * file (e.g. an image dragged off a web page). Same staging pipeline and
   * return shape as image:stage. */
  "image:stage-data": [
    { branchId: string; images: Array<{ filename: string; dataBase64: string }> },
    { staged: MessageImage[]; skipped: Array<{ filename: string; reason: string }> },
  ];
  /** Read a staged/attached image back as a data URL for display in the
   * renderer (which has no filesystem access). Null if the blob is missing. */
  "attachment:data": [{ blobPath: string }, string | null];

  // Organisations
  "org:list": [void, Organisation[]];
  "org:create": [{ name: string }, Organisation];
  "org:rename": [{ id: string; name: string }, void];
  /** HARD delete: every project in the org goes the project:delete way. False = refused (last org) or unknown. */
  "org:delete": [{ id: string }, boolean];
  /** What deleting an org would take with it — drives the delete confirm. */
  "org:impact": [{ id: string }, { projects: number; spaces: number; chats: number; artifacts: number; memories: number }];
  /** Which providers have an org-level API key set (never returns the keys themselves). */
  "org:keys": [{ id: string }, Record<string, boolean>];
  /** Merge org-level API keys: null clears, empty strings are ignored, values are set. */
  "org:set-keys": [{ id: string; keys: Record<string, string | null> }, void];

  // Projects
  "project:list": [{ orgId: string }, Project[]];
  "project:create": [{ orgId: string; name: string }, Project];
  "project:get": [{ id: string }, Project | null];
  "project:rename": [{ id: string; name: string }, void];
  /** Partial update from project settings; omitted fields stay untouched. */
  "project:update": [{ id: string; name?: string; description?: string; icon?: string | null; systemPrompt?: string }, void];
  "project:delete": [{ id: string }, boolean];
  /** What deleting a project would take with it — drives the delete confirm. */
  "project:impact": [{ id: string }, { spaces: number; chats: number; artifacts: number; memories: number }];
  /** Persist a drag-reorder of the project rail (ids in display order). */
  "project:reorder": [{ orgId: string; ids: string[] }, void];
  /** Move a project into another organisation. */
  "project:move": [{ id: string; orgId: string }, void];

  // Spaces
  "space:list": [{ projectId: string }, Space[]];
  "space:create": [{ projectId: string; name: string }, Space];
  "space:rename": [{ id: string; name: string }, void];
  "space:delete": [{ id: string }, boolean];
  /** What deleting a space would take with it — drives the delete confirm. */
  "space:impact": [{ id: string }, { chats: number; artifacts: number; memories: number }];

  // Chats
  "chat:list": [{ projectId: string }, Chat[]];
  /** Omitting the name creates a "New chat" that auto-titles itself after its first exchange. */
  "chat:create": [{ projectId: string; name?: string; spaceId?: string }, Chat];
  "chat:rename": [{ id: string; name: string }, void];
  "chat:delete": [{ id: string }, boolean];
  /** What deleting a chat would take with it — drives the delete confirm. */
  "chat:impact": [{ id: string }, { branches: number; artifacts: number; memories: number }];
  /** Fork a branch at its current head into a new sibling branch. */
  "branch:fork": [{ branchId: string; name: string }, Branch];
  /** Export one branch's conversation via a native save dialog; resolves to the file path, or null if cancelled. */
  "branch:export": [{ id: string; format: "markdown" }, string | null];

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
  /** A branch's transcript: inherited ancestry (same walk prompt assembly uses) followed by its own messages. */
  "message:list": [{ branchId: string }, Array<{ id: string; role: string; content: string; turn: number; timestamp: number; model?: string; toolCalls?: Array<{ name: string; success: boolean }>; images?: MessageImage[]; inherited?: boolean }>];
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
  /** The exact fact set feeding this branch's prompt (same resolution as prompt assembly). */
  "memory:for-branch": [{ branchId: string }, MemoryFact[]];

  // Context inspector (right panel)
  /** Last-turn context stats for a branch; null until a turn has run. */
  "context:stats": [{ branchId: string }, ContextStats | null];
  /** The branch project's artifacts (live only), with token estimates and
   * the branch's current selection — drives the panel's checkboxes. */
  "artifact:for-branch": [{ branchId: string }, { selected: string[]; artifacts: SelectableArtifact[] }];
  /** Replace the branch's attached-artifact selection (whole-array set). */
  "branch:artifacts-set": [{ branchId: string; artifactIds: string[] }, void];
  /**
   * Attach files to a branch: parse each to text, persist as an artifact, and
   * auto-add it to this branch's selection. With no `paths`, opens a native
   * file picker; `paths` (e.g. from a drag-drop) skips the dialog. Returns what
   * landed and what was skipped (unsupported type, or no extractable text —
   * e.g. a scanned PDF), so the UI can report honestly.
   */
  "artifact:upload": [
    { branchId: string; paths?: string[] },
    {
      /** `note` carries an accepted-with-caveat warning to surface (e.g. a
       * scanned PDF only natively-PDF-capable models can read). */
      created: Array<{ id: string; title: string; type: string; note?: string }>;
      skipped: Array<{ filename: string; reason: string }>;
    },
  ];

  // Models
  /** Selectable models per router entry — the full catalogue minus disabled ones. */
  "models:list": [void, Record<string, string[]>];
  /** The unfiltered catalogue, for the per-provider model management page. */
  "models:all": [void, Record<string, string[]>];

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
  /** Which providers have a global API key set (never returns the keys themselves). */
  "config:keys": [void, Record<string, boolean>];

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

  // Window
  "window:is-fullscreen": [void, boolean];

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
  /** Fired when a chat auto-titles itself off its first exchange, so the
   * sidebar/breadcrumb pick up the new name without a manual refetch. */
  "chat:titled": { chatId: string; name: string };
  /** macOS hides the traffic lights in fullscreen; the renderer drops the
   * space it reserves for them. */
  "window:fullscreen-changed": boolean;
}

// ── Channel name helpers ──────────────────────────────────────────────────────

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

export type IpcInvokeRequest<C extends IpcInvokeChannel> = IpcInvokeMap[C][0];
export type IpcInvokeResponse<C extends IpcInvokeChannel> = IpcInvokeMap[C][1];
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C];
