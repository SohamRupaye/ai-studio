export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  turn: number;
  timestamp: number;
  /** Model that generated this message — set on assistant turns. */
  model?: string;
  /** Tool activity of the turn that produced this assistant message. */
  toolCalls?: Array<{ name: string; success: boolean }>;
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
