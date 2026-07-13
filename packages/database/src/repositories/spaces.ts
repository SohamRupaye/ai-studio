import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Space } from "@ai-studio/shared";

export class SpacesRepository {
  constructor(private db: Database.Database) {}

  createSpace(projectId: string, name: string): Space {
    const s: Space = { id: randomUUID(), projectId, name, createdAt: Date.now() };
    this.db.prepare("INSERT INTO spaces (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(s.id, s.projectId, s.name, s.createdAt, s.createdAt);
    return s;
  }

  getSpace(id: string): Space | undefined {
    const row = this.db.prepare("SELECT * FROM spaces WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, projectId: row.project_id, name: row.name, createdAt: row.created_at };
  }

  listSpaces(projectId: string): Space[] {
    return (this.db.prepare("SELECT * FROM spaces WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at").all(projectId) as any[])
      .map(r => ({ id: r.id, projectId: r.project_id, name: r.name, createdAt: r.created_at }));
  }

  renameSpace(id: string, name: string): void {
    this.db.prepare("UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /**
   * What deleting this space takes with it: its live chats, every branch of
   * those chats (soft-deleted ones included — their artifacts and scoped
   * memories are still live), and the live artifact count on those branches.
   * Callers use the ids to purge chat-/branch-scoped memories, which live
   * outside this store.
   */
  spaceImpact(id: string): { chatIds: string[]; branchIds: string[]; artifacts: number } {
    const chatIds = (this.db
      .prepare("SELECT id FROM chats WHERE space_id = ? AND deleted_at IS NULL")
      .all(id) as any[]).map(r => r.id);
    const branchIds = (this.db
      .prepare("SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE space_id = ? AND deleted_at IS NULL)")
      .all(id) as any[]).map(r => r.id);
    const artifacts = (this.db
      .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE deleted_at IS NULL AND branch_id IN (SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE space_id = ? AND deleted_at IS NULL))")
      .get(id) as any).n as number;
    return { chatIds, branchIds, artifacts };
  }

  /**
   * Soft-delete a space and everything in it — chats, their branches, and
   * those branches' artifacts — matching deleteChat's model. Soft, not hard:
   * kept rows still satisfy the FKs from soft-deleted chats, and "git for
   * context" shouldn't destroy context. The knowledge graph is a separate
   * store and is deliberately untouched. A project may end up with no
   * spaces; ensureDefaultSpace recreates "General" on demand.
   */
  deleteSpace(id: string): boolean {
    const space = this.getSpace(id);
    if (!space) return false;
    const now = Date.now();
    this.db.transaction(() => {
      // Artifacts and branches resolve their targets through live chats, so
      // they must run before the chats update marks those rows deleted.
      this.db.prepare(
        "UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND branch_id IN (SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE space_id = ? AND deleted_at IS NULL))"
      ).run(now, now, id);
      this.db.prepare(
        "UPDATE branches SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND chat_id IN (SELECT id FROM chats WHERE space_id = ? AND deleted_at IS NULL)"
      ).run(now, now, id);
      this.db.prepare("UPDATE chats SET deleted_at = ?, updated_at = ? WHERE space_id = ? AND deleted_at IS NULL").run(now, now, id);
      this.db.prepare("UPDATE spaces SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    })();
    return true;
  }

  /** Oldest space of the project, creating "General" if the project has none. */
  ensureDefaultSpace(projectId: string): Space {
    const existing = this.listSpaces(projectId);
    if (existing.length) return existing[0];
    return this.createSpace(projectId, "General");
  }
}
