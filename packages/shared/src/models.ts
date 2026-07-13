/** An image attached to a user message. Bytes live on disk under data/blobs;
 * the row stores this reference. mediaType is the image mime (e.g. image/png). */
export interface MessageImage {
  blobPath: string;
  mediaType: string;
  filename: string;
}

/** One step of a delegated agent's transcript: a stretch of text the agent
 * wrote, or a tool call (with an args preview and, once finished, its
 * outcome). Interleaved in the order they happened. */
export interface SubagentStep {
  type: "text" | "tool";
  /** type "text": what the agent wrote (accumulated deltas, capped). */
  text?: string;
  /** type "tool": tool name. */
  tool?: string;
  /** type "tool": compact one-line JSON args preview. */
  args?: string;
  /** type "tool": set when the call finishes. */
  success?: boolean;
  /** type "tool": short preview of the tool's output. */
  resultPreview?: string;
}

/** One delegated agent's record inside a subagent/delegate tool call —
 * persisted with the message so "what did each agent do" survives reopen. */
export interface SubagentRunRecord {
  agentId: string;
  task: string;
  model: string;
  status: "running" | "done" | "failed";
  /** The agent's full transcript: text + tool steps, in order. */
  steps: SubagentStep[];
  result?: string;
  error?: string;
  /** Wall-clock duration, set when the run finishes. */
  durationMs?: number;
}

export interface MessageToolCall {
  name: string;
  success: boolean;
  /** Compact one-line JSON of the call's arguments (capped at persist time) —
   * lets the UI answer "what command ran" and rides the hot window so the
   * model remembers its own actions on later turns. */
  argsPreview?: string;
  /** Short preview of the tool's output (capped at persist time). */
  resultPreview?: string;
  /** Human-salient one-liner (the bash command, the fetched URL, the search
   * query) — what the row leads with. See toolCallSummary in tool-call.ts. */
  summary?: string;
  /** Full arguments for the expandable detail panel (pretty JSON or the bare
   * string for single-string-arg tools; capped with a visible marker). */
  args?: string;
  /** Full tool output for the detail panel (capped with a visible marker). */
  result?: string;
  /** Per-agent detail for subagent/delegate calls. */
  agents?: SubagentRunRecord[];
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  turn: number;
  timestamp: number;
  /** Model that generated this message — set on assistant turns. */
  model?: string;
  /** Tool activity of the turn that produced this assistant message. */
  toolCalls?: MessageToolCall[];
  /** The model's reasoning/thinking for this turn (assistant messages only;
   * capped at persist time). User-facing visibility — never fed back to the
   * model in later turns. */
  thinking?: string;
  /** Images the user attached to this turn (user messages only). */
  images?: MessageImage[];
}

export interface Summary {
  branchId: string;
  fromTurn: number;
  toTurn: number;
  content: string;
  timestamp: number;
}

export interface Organisation {
  id: string;
  name: string;
  createdAt: number;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  /** Small data-URL image for the rail tile; absent = initial letter. */
  icon?: string | null;
  description?: string;
  /** Custom instructions layered into the system prompt of every chat in the project. */
  systemPrompt?: string;
  createdAt: number;
}

// Functional area within a project (e.g. Design, Development, Business).
// Owns chats today; memories/artifacts scope to it as those features land.
export interface Space {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  projectId: string;
  spaceId: string;
  name: string;
  createdAt: number;
  /** True while the chat still carries its placeholder name and is waiting
   * to be auto-titled from its first exchange. Cleared by any rename. */
  autoName?: boolean;
}

export interface Branch {
  id: string;
  chatId?: string;
  name: string;
  model: string;
  parentId?: string;
  forkAtIndex?: number;
  pins: string[];
  /** Artifact ids the user attached to this branch's context (fed to prompt
   * assembly as <selected_artifacts>). Forks inherit the parent's selection. */
  selectedArtifacts: string[];
  createdAt: number;
}
