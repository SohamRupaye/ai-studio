import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Project } from "@squirl/shared";

export class ProjectsRepository {
  constructor(private db: Database.Database) {}

  createProject(orgId: string, name: string): Project {
    const p: Project = { id: randomUUID(), orgId, name, createdAt: Date.now() };
    // sort_order = creation time, so new projects append after reordered rows.
    this.db.prepare("INSERT INTO projects (id, org_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(p.id, p.orgId, p.name, p.createdAt, p.createdAt, p.createdAt);
    return p;
  }

  private rowToProject(r: any): Project {
    return {
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      icon: r.icon ?? null,
      description: r.description ?? "",
      systemPrompt: r.system_prompt ?? "",
      createdAt: r.created_at,
    };
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return this.rowToProject(row);
  }

  listProjects(orgId: string): Project[] {
    return (this.db.prepare("SELECT * FROM projects WHERE org_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at").all(orgId) as any[])
      .map(r => this.rowToProject(r));
  }

  renameProject(id: string, name: string): void {
    this.db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /** Partial update from the settings page; omitted fields stay untouched. */
  updateProject(id: string, patch: { name?: string; description?: string; icon?: string | null; systemPrompt?: string }): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { sets.push("name = ?"); values.push(patch.name); }
    if (patch.description !== undefined) { sets.push("description = ?"); values.push(patch.description); }
    if (patch.icon !== undefined) { sets.push("icon = ?"); values.push(patch.icon); }
    if (patch.systemPrompt !== undefined) { sets.push("system_prompt = ?"); values.push(patch.systemPrompt); }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    values.push(Date.now(), id);
    this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  /** Move a project to another organisation, appending at the rail's end. */
  moveProject(id: string, orgId: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE projects SET org_id = ?, sort_order = ?, updated_at = ? WHERE id = ?")
      .run(orgId, now, now, id);
  }

  /** Persist a drag-reorder: ids in display order become sort_order 0..n-1. */
  reorderProjects(orgId: string, ids: string[]): void {
    const now = Date.now();
    const update = this.db.prepare("UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND org_id = ?");
    this.db.transaction(() => {
      ids.forEach((id, index) => update.run(index, now, id, orgId));
    })();
  }

  /**
   * What deleting this project takes with it: live spaces and chats, every
   * branch of those chats (soft-deleted ones included — their artifacts and
   * scoped memories are still live), and the live artifact count. Callers use
   * the ids to purge project-/chat-/branch-scoped memories.
   */
  projectImpact(id: string): { spaceIds: string[]; chatIds: string[]; branchIds: string[]; artifacts: number } {
    const spaceIds = (this.db
      .prepare("SELECT id FROM spaces WHERE project_id = ? AND deleted_at IS NULL")
      .all(id) as any[]).map(r => r.id);
    const chatIds = (this.db
      .prepare("SELECT id FROM chats WHERE project_id = ? AND deleted_at IS NULL")
      .all(id) as any[]).map(r => r.id);
    const branchIds = (this.db
      .prepare("SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ? AND deleted_at IS NULL)")
      .all(id) as any[]).map(r => r.id);
    const artifacts = (this.db
      .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ? AND deleted_at IS NULL")
      .get(id) as any).n as number;
    return { spaceIds, chatIds, branchIds, artifacts };
  }

  /**
   * HARD-delete a project and everything in it — spaces, chats, branches,
   * messages, summaries, costs, artifacts — including rows earlier deletes
   * only soft-deleted. This is the app's one irreversible delete (the UI
   * gates it behind a typed challenge); space/chat deletion stays soft.
   * Returns the purged chat/branch ids so callers can also clear scoped
   * memories and knowledge-graph nodes, or null if the project is unknown.
   */
  deleteProject(id: string): { chatIds: string[]; branchIds: string[] } | null {
    // Raw existence check, NOT getProject: rows soft-deleted during the
    // soft-delete era must still be hard-deletable (org purge relies on it).
    const exists = this.db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
    if (!exists) return null;
    // ALL rows, soft-deleted included — this purge is total.
    const chatIds = (this.db
      .prepare("SELECT id FROM chats WHERE project_id = ?")
      .all(id) as any[]).map(r => r.id);
    const branchIds = (this.db
      .prepare("SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ?)")
      .all(id) as any[]).map(r => r.id);
    this.db.transaction(() => {
      // Children before parents — foreign keys are enforced.
      const branchesOfProject = "SELECT id FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ?)";
      this.db.prepare(`DELETE FROM messages WHERE branch_id IN (${branchesOfProject})`).run(id);
      this.db.prepare(`DELETE FROM summaries WHERE branch_id IN (${branchesOfProject})`).run(id);
      this.db.prepare(`DELETE FROM costs WHERE branch_id IN (${branchesOfProject})`).run(id);
      this.db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM branches WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ?)").run(id);
      this.db.prepare("DELETE FROM chats WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM spaces WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    })();
    return { chatIds, branchIds };
  }
}
