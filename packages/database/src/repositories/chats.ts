import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Chat } from "@squirl/shared";
import type { SpacesRepository } from "./spaces.js";
import type { BranchesRepository } from "./branches.js";

export class ChatsRepository {
  constructor(
    private db: Database.Database,
    private spaces: SpacesRepository,
    private branches: BranchesRepository,
  ) {}

  createChat(projectId: string, name: string, spaceId?: string, mainBranchModel?: string, autoName = false): Chat {
    const space = spaceId ?? this.spaces.ensureDefaultSpace(projectId).id;
    const c: Chat = { id: randomUUID(), projectId, spaceId: space, name, createdAt: Date.now(), autoName };
    this.db.prepare("INSERT INTO chats (id, project_id, space_id, name, auto_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.id, c.projectId, c.spaceId, c.name, autoName ? 1 : 0, c.createdAt, c.createdAt);
    // Every chat is born on its trunk: a "main" branch, git-style, so there is
    // never an unusable branchless chat. An empty model string is fine — the
    // chat runtime falls back to the configured default model.
    this.branches.createBranch("main", mainBranchModel ?? "", undefined, undefined, c.id);
    return c;
  }

  getChat(id: string): Chat | undefined {
    const row = this.db.prepare("SELECT * FROM chats WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, projectId: row.project_id, spaceId: row.space_id, name: row.name, createdAt: row.created_at, autoName: !!row.auto_name };
  }

  listChats(projectId: string): Chat[] {
    return (this.db.prepare("SELECT * FROM chats WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at").all(projectId) as any[])
      .map(r => ({ id: r.id, projectId: r.project_id, spaceId: r.space_id, name: r.name, createdAt: r.created_at, autoName: !!r.auto_name }));
  }

  /** Any rename — user-typed or generated — settles the name for good. */
  renameChat(id: string, name: string): void {
    this.db.prepare("UPDATE chats SET name = ?, auto_name = 0, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /**
   * What deleting this chat takes with it: every branch (soft-deleted ones
   * included — their artifacts and scoped memories are still live), the live
   * branch count for display, and the live artifact count. Callers use the
   * ids to purge chat-/branch-scoped memories, which live outside this store.
   */
  chatImpact(id: string): { branchIds: string[]; branches: number; artifacts: number } {
    const branchIds = (this.db
      .prepare("SELECT id FROM branches WHERE chat_id = ?")
      .all(id) as any[]).map(r => r.id);
    const branches = (this.db
      .prepare("SELECT COUNT(*) AS n FROM branches WHERE chat_id = ? AND deleted_at IS NULL")
      .get(id) as any).n as number;
    const artifacts = (this.db
      .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE deleted_at IS NULL AND branch_id IN (SELECT id FROM branches WHERE chat_id = ?)")
      .get(id) as any).n as number;
    return { branchIds, branches, artifacts };
  }

  /**
   * Soft-delete a chat, its branches, and those branches' artifacts —
   * the same cascade deleteSpace applies per chat.
   */
  deleteChat(id: string): boolean {
    const chat = this.getChat(id);
    if (!chat) return false;
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND branch_id IN (SELECT id FROM branches WHERE chat_id = ?)").run(now, now, id);
      this.db.prepare("UPDATE branches SET deleted_at = ?, updated_at = ? WHERE chat_id = ?").run(now, now, id);
      this.db.prepare("UPDATE chats SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    })();
    return true;
  }
}
