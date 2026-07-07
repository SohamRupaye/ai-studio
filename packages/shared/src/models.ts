export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  turn: number;
  timestamp: number;
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
}

export interface Branch {
  id: string;
  chatId?: string;
  name: string;
  model: string;
  parentId?: string;
  forkAtIndex?: number;
  pins: string[];
  createdAt: number;
}
