import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Branch, Message, Summary, Organisation, Project, Chat } from "@ai-studio/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS organisations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS team_members (
  id      TEXT PRIMARY KEY,
  org_id  TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role    TEXT NOT NULL DEFAULT 'member',
  joined_at REAL,
  UNIQUE(org_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organisations(id),
  name       TEXT NOT NULL,
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT REFERENCES chats(id),
  name          TEXT NOT NULL,
  model         TEXT NOT NULL,
  parent_id     TEXT,
  fork_at_index INTEGER,
  pins          TEXT DEFAULT '[]',
  created_by    TEXT REFERENCES users(id),
  created_at    REAL,
  updated_at    REAL,
  deleted_at    REAL
);

CREATE TABLE IF NOT EXISTS messages (
  id        TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  role      TEXT NOT NULL,
  content   TEXT NOT NULL,
  model     TEXT,
  user_id   TEXT REFERENCES users(id),
  turn      INTEGER NOT NULL,
  timestamp REAL
);

CREATE TABLE IF NOT EXISTS summaries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  from_turn INTEGER NOT NULL,
  to_turn   INTEGER NOT NULL,
  content   TEXT NOT NULL,
  timestamp REAL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT REFERENCES branches(id),
  project_id TEXT REFERENCES projects(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at REAL,
  updated_at REAL,
  deleted_at REAL
);

CREATE TABLE IF NOT EXISTS costs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id    TEXT REFERENCES branches(id),
  model        TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd     REAL NOT NULL,
  timestamp    REAL
);

CREATE INDEX IF NOT EXISTS idx_messages_branch_turn ON messages(branch_id, turn);
CREATE INDEX IF NOT EXISTS idx_branches_chat ON branches(chat_id);
CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_branch ON artifacts(branch_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_costs_branch ON costs(branch_id);
CREATE INDEX IF NOT EXISTS idx_team_members_org ON team_members(org_id);
`;

export class Store {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(process.cwd(), "data", "workspace.db");
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate() {
    const branchCols = this.db.prepare("PRAGMA table_info(branches)").all() as any[];
    if (!branchCols.find((c: any) => c.name === "chat_id")) {
      this.db.exec("ALTER TABLE branches ADD COLUMN chat_id TEXT REFERENCES chats(id)");
    }
    if (!branchCols.find((c: any) => c.name === "deleted_at")) {
      this.db.exec("ALTER TABLE branches ADD COLUMN deleted_at REAL");
    }
    if (!branchCols.find((c: any) => c.name === "updated_at")) {
      this.db.exec("ALTER TABLE branches ADD COLUMN updated_at REAL");
    }
    if (!branchCols.find((c: any) => c.name === "created_by")) {
      this.db.exec("ALTER TABLE branches ADD COLUMN created_by TEXT");
    }
    const msgCols = this.db.prepare("PRAGMA table_info(messages)").all() as any[];
    if (!msgCols.find((c: any) => c.name === "model")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN model TEXT");
    }
    if (!msgCols.find((c: any) => c.name === "user_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN user_id TEXT");
    }
  }

  // ── Organisations ──────────────────────────────────────────────────────────

  createOrganisation(name: string): Organisation {
    const org: Organisation = { id: randomUUID(), name, createdAt: Date.now() };
    this.db.prepare("INSERT INTO organisations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(org.id, org.name, org.createdAt, org.createdAt);
    return org;
  }

  getOrganisation(id: string): Organisation | undefined {
    const row = this.db.prepare("SELECT * FROM organisations WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, name: row.name, createdAt: row.created_at };
  }

  listOrganisations(): Organisation[] {
    return (this.db.prepare("SELECT * FROM organisations ORDER BY created_at").all() as any[])
      .map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  createProject(orgId: string, name: string): Project {
    const p: Project = { id: randomUUID(), orgId, name, createdAt: Date.now() };
    this.db.prepare("INSERT INTO projects (id, org_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(p.id, p.orgId, p.name, p.createdAt, p.createdAt);
    return p;
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, orgId: row.org_id, name: row.name, createdAt: row.created_at };
  }

  listProjects(orgId: string): Project[] {
    return (this.db.prepare("SELECT * FROM projects WHERE org_id = ? ORDER BY created_at").all(orgId) as any[])
      .map(r => ({ id: r.id, orgId: r.org_id, name: r.name, createdAt: r.created_at }));
  }

  // ── Chats ──────────────────────────────────────────────────────────────────

  createChat(projectId: string, name: string): Chat {
    const c: Chat = { id: randomUUID(), projectId, name, createdAt: Date.now() };
    this.db.prepare("INSERT INTO chats (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(c.id, c.projectId, c.name, c.createdAt, c.createdAt);
    return c;
  }

  getChat(id: string): Chat | undefined {
    const row = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, projectId: row.project_id, name: row.name, createdAt: row.created_at };
  }

  listChats(projectId: string): Chat[] {
    return (this.db.prepare("SELECT * FROM chats WHERE project_id = ? ORDER BY created_at").all(projectId) as any[])
      .map(r => ({ id: r.id, projectId: r.project_id, name: r.name, createdAt: r.created_at }));
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  createBranch(name: string, model: string, parentId?: string, forkAt?: number, chatId?: string): Branch {
    const branch: Branch = {
      id: randomUUID(),
      chatId,
      name,
      model,
      parentId,
      forkAtIndex: forkAt,
      pins: [],
      createdAt: Date.now(),
    };
    this.db.prepare(
      `INSERT INTO branches (id, chat_id, name, model, parent_id, fork_at_index, pins, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(branch.id, branch.chatId ?? null, branch.name, branch.model, branch.parentId ?? null, branch.forkAtIndex ?? null, "[]", branch.createdAt, branch.createdAt);
    return branch;
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
      createdAt: row.created_at,
    };
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  addMessage(branchId: string, role: string, content: string, model?: string): Message {
    // Use MAX(turn)+1 to avoid reuse after undo
    const row = this.db.prepare("SELECT MAX(turn) as maxTurn FROM messages WHERE branch_id = ?").get(branchId) as any;
    const turn = (row?.maxTurn ?? -1) + 1;
    const msg: Message = {
      id: randomUUID(),
      role: role as Message["role"],
      content,
      turn,
      timestamp: Date.now(),
    };
    this.db.prepare(
      `INSERT INTO messages (id, branch_id, role, content, model, turn, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(msg.id, branchId, msg.role, msg.content, model ?? null, msg.turn, msg.timestamp);
    return msg;
  }

  getMessages(branchId: string): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE branch_id = ? ORDER BY turn").all(branchId) as any[];
    return rows.map(r => ({ id: r.id, role: r.role, content: r.content, turn: r.turn, timestamp: r.timestamp }));
  }

  getMessageCount(branchId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE branch_id = ?").get(branchId) as any;
    return row.cnt;
  }

  deleteLastMessage(branchId: string): boolean {
    const row = this.db.prepare("SELECT id FROM messages WHERE branch_id = ? ORDER BY turn DESC LIMIT 1").get(branchId) as any;
    if (!row) return false;
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    return true;
  }

  /**
   * Delete a user message at `turn` and everything after it in the branch
   * (the old assistant response plus any later turns). The caller is
   * expected to immediately re-send the edited text via the normal chat
   * flow (which calls addMessage and picks the next free turn), so this
   * never leaves two rows fighting over the same turn number.
   * No-op if there's no message at that turn.
   */
  editMessage(branchId: string, turn: number): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn) as any;
      if (!row) return;
      this.db.prepare("DELETE FROM messages WHERE branch_id = ? AND turn >= ?").run(branchId, turn);
    })();
  }

  /**
   * Delete the user message at `turn` plus its paired assistant response
   * (the very next message, if present) so a deleted prompt also removes
   * its reply. Returns the number of messages actually deleted.
   */
  deleteMessagePair(branchId: string, turn: number): number {
    let removed = 0;
    this.db.transaction(() => {
      const target = this.db.prepare("SELECT id, turn FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn) as any;
      if (!target) return;
      this.db.prepare("DELETE FROM messages WHERE id = ?").run(target.id);
      removed++;
      const next = this.db.prepare("SELECT id, role FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn + 1) as any;
      if (next && next.role === "assistant") {
        this.db.prepare("DELETE FROM messages WHERE id = ?").run(next.id);
        removed++;
      }
    })();
    return removed;
  }

  undoLastTurn(branchId: string): number {
    let removed = 0;
    this.db.transaction(() => {
      const msgs = this.db.prepare("SELECT id, role FROM messages WHERE branch_id = ? ORDER BY turn DESC LIMIT 2").all(branchId) as any[];
      if (msgs.length && msgs[0].role === "assistant") {
        this.db.prepare("DELETE FROM messages WHERE id = ?").run(msgs[0].id);
        removed++;
        if (msgs.length > 1 && msgs[1].role === "user") {
          this.db.prepare("DELETE FROM messages WHERE id = ?").run(msgs[1].id);
          removed++;
        }
      }
    })();
    return removed;
  }

  // ── Summaries ──────────────────────────────────────────────────────────────

  addSummary(branchId: string, fromTurn: number, toTurn: number, content: string): Summary {
    const s: Summary = { branchId, fromTurn, toTurn, content, timestamp: Date.now() };
    this.db.prepare(
      `INSERT INTO summaries (branch_id, from_turn, to_turn, content, timestamp) VALUES (?, ?, ?, ?, ?)`
    ).run(branchId, fromTurn, toTurn, content, s.timestamp);
    return s;
  }

  getSummaries(branchId: string): Summary[] {
    const rows = this.db.prepare("SELECT * FROM summaries WHERE branch_id = ? ORDER BY from_turn").all(branchId) as any[];
    return rows.map(r => ({ branchId: r.branch_id, fromTurn: r.from_turn, toTurn: r.to_turn, content: r.content, timestamp: r.timestamp }));
  }

  replaceSummaries(branchId: string, newSummaries: Summary[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM summaries WHERE branch_id = ?").run(branchId);
      const stmt = this.db.prepare("INSERT INTO summaries (branch_id, from_turn, to_turn, content, timestamp) VALUES (?, ?, ?, ?, ?)");
      for (const s of newSummaries) stmt.run(branchId, s.fromTurn, s.toTurn, s.content, s.timestamp || Date.now());
    })();
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────

  createArtifact(branchId: string, projectId: string, type: string, title: string, content: string): any {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO artifacts (id, branch_id, project_id, type, title, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, branchId, projectId, type, title, content, now, now);
    return { id, branchId, projectId, type, title, content, version: 1, createdAt: now };
  }

  updateArtifact(id: string, content: string, title?: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE artifacts SET content = ?, title = COALESCE(?, title), version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(content, title ?? null, now, id);
  }

  getArtifact(id: string): any | undefined {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, branchId: row.branch_id, projectId: row.project_id, type: row.type, title: row.title, content: row.content, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listArtifacts(projectId: string): any[] {
    return (this.db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC").all(projectId) as any[])
      .map(r => ({ id: r.id, branchId: r.branch_id, projectId: r.project_id, type: r.type, title: r.title, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  // ── Costs ──────────────────────────────────────────────────────────────────

  recordCost(branchId: string, model: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.db.prepare(
      `INSERT INTO costs (branch_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(branchId, model, inputTokens, outputTokens, costUsd, Date.now());
  }

  getCosts(branchId: string): Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; timestamp: number }> {
    return (this.db.prepare("SELECT * FROM costs WHERE branch_id = ? ORDER BY timestamp").all(branchId) as any[])
      .map(r => ({ model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, timestamp: r.timestamp }));
  }

  getProjectCosts(projectId: string): { totalCost: number; totalInput: number; totalOutput: number } {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(c.cost_usd), 0) as total_cost,
             COALESCE(SUM(c.input_tokens), 0) as total_input,
             COALESCE(SUM(c.output_tokens), 0) as total_output
      FROM costs c
      JOIN branches b ON c.branch_id = b.id
      JOIN chats ch ON b.chat_id = ch.id
      WHERE ch.project_id = ?
    `).get(projectId) as any;
    return { totalCost: row.total_cost, totalInput: row.total_input, totalOutput: row.total_output };
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as any;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  getActiveBranchId(): string | undefined {
    return this.getMeta("active_branch");
  }

  setActiveBranchId(id: string): void {
    this.setMeta("active_branch", id);
  }

  // ── Defaults ───────────────────────────────────────────────────────────────

  ensureDefaults(defaultModel: string): void {
    const orgs = this.listOrganisations();
    if (orgs.length) return;

    const org = this.createOrganisation("Personal");
    const project = this.createProject(org.id, "Default Project");
    const chat = this.createChat(project.id, "General");
    const branches = this.listBranches();
    if (!branches.length) {
      this.createBranch("main", defaultModel, undefined, undefined, chat.id);
    } else {
      for (const b of branches) {
        if (!b.chatId) {
          this.db.prepare("UPDATE branches SET chat_id = ? WHERE id = ?").run(chat.id, b.id);
        }
      }
    }
  }
}
