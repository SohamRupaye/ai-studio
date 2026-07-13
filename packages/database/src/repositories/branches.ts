import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Branch } from "@ai-studio/shared";

export class BranchesRepository {
  constructor(private db: Database.Database) {}

  createBranch(name: string, model: string, parentId?: string, forkAt?: number, chatId?: string): Branch {
    // A fork inherits the parent's attached artifacts — same git-for-context
    // semantics as inheriting the transcript.
    const inheritedArtifacts = parentId ? this.getBranch(parentId)?.selectedArtifacts ?? [] : [];
    const branch: Branch = {
      id: randomUUID(),
      chatId,
      name,
      model,
      parentId,
      forkAtIndex: forkAt,
      pins: [],
      selectedArtifacts: inheritedArtifacts,
      createdAt: Date.now(),
    };
    this.db.prepare(
      `INSERT INTO branches (id, chat_id, name, model, parent_id, fork_at_index, pins, selected_artifacts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(branch.id, branch.chatId ?? null, branch.name, branch.model, branch.parentId ?? null, branch.forkAtIndex ?? null, "[]", JSON.stringify(inheritedArtifacts), branch.createdAt, branch.createdAt);
    return branch;
  }

  /** Replace a branch's attached-artifact selection (whole-array set). */
  setSelectedArtifacts(branchId: string, artifactIds: string[]): void {
    this.db.prepare("UPDATE branches SET selected_artifacts = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(artifactIds), Date.now(), branchId);
  }

  /** Lookup by exact ID only. */
  getBranch(id: string): Branch | undefined {
    const row = this.db.prepare("SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return this.rowToBranch(row);
  }

  /** Lookup by name (first match). */
  getBranchByName(name: string): Branch | undefined {
    const row = this.db.prepare("SELECT * FROM branches WHERE name = ? AND deleted_at IS NULL").get(name) as any;
    if (!row) return undefined;
    return this.rowToBranch(row);
  }

  listBranches(chatId?: string): Branch[] {
    const query = chatId
      ? "SELECT * FROM branches WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at"
      : "SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY created_at";
    const rows = (chatId ? this.db.prepare(query).all(chatId) : this.db.prepare(query).all()) as any[];
    return rows.map(r => this.rowToBranch(r));
  }

  updateBranchModel(id: string, model: string): void {
    this.db.prepare("UPDATE branches SET model = ?, updated_at = ? WHERE id = ?").run(model, Date.now(), id);
  }

  updateBranchName(id: string, name: string): void {
    this.db.prepare("UPDATE branches SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /** Soft delete: sets deleted_at. Reassigns children to grandparent. */
  deleteBranch(id: string): boolean {
    const branch = this.getBranch(id);
    if (!branch) return false;

    this.db.transaction(() => {
      // Reassign child branches to grandparent
      this.db.prepare("UPDATE branches SET parent_id = ? WHERE parent_id = ?").run(branch.parentId ?? null, id);
      // Soft delete
      this.db.prepare("UPDATE branches SET deleted_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), id);
    })();
    return true;
  }

  addPin(branchId: string, text: string): void {
    const branch = this.getBranch(branchId);
    if (!branch) return;
    branch.pins.push(text);
    this.db.prepare("UPDATE branches SET pins = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(branch.pins), Date.now(), branchId);
  }

  removePin(branchId: string, index: number): boolean {
    const branch = this.getBranch(branchId);
    if (!branch || index < 0 || index >= branch.pins.length) return false;
    branch.pins.splice(index, 1);
    this.db.prepare("UPDATE branches SET pins = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(branch.pins), Date.now(), branchId);
    return true;
  }

  private rowToBranch(row: any): Branch {
    return {
      id: row.id,
      chatId: row.chat_id ?? undefined,
      name: row.name,
      model: row.model,
      parentId: row.parent_id ?? undefined,
      forkAtIndex: row.fork_at_index ?? undefined,
      pins: JSON.parse(row.pins || "[]"),
      selectedArtifacts: JSON.parse(row.selected_artifacts || "[]"),
      createdAt: row.created_at,
    };
  }
}
