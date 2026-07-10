import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Branch, Message, MessageImage, Summary, Organisation, Project, Space, Chat } from "@ai-studio/shared";

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
  api_keys   TEXT,
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
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organisations(id),
  name          TEXT NOT NULL,
  icon          TEXT,
  description   TEXT,
  system_prompt TEXT,
  sort_order    INTEGER,
  created_at    REAL,
  updated_at    REAL,
  deleted_at    REAL
);

CREATE TABLE IF NOT EXISTS spaces (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  created_at REAL,
  updated_at REAL,
  deleted_at REAL
);

CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  space_id   TEXT REFERENCES spaces(id),
  name       TEXT NOT NULL,
  auto_name  INTEGER DEFAULT 0,
  created_at REAL,
  updated_at REAL,
  deleted_at REAL
);

CREATE TABLE IF NOT EXISTS branches (
  id                 TEXT PRIMARY KEY,
  chat_id            TEXT REFERENCES chats(id),
  name               TEXT NOT NULL,
  model              TEXT NOT NULL,
  parent_id          TEXT,
  fork_at_index      INTEGER,
  pins               TEXT DEFAULT '[]',
  selected_artifacts TEXT DEFAULT '[]',
  created_by         TEXT REFERENCES users(id),
  created_at         REAL,
  updated_at         REAL,
  deleted_at         REAL
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
  -- 'extracted' (pulled from an agent reply) or 'upload' (user-attached file).
  source     TEXT DEFAULT 'extracted',
  -- Upload provenance: original filename, mime, relative path to the preserved
  -- bytes under data/blobs (NULL when content IS the whole original, e.g. text),
  -- size, and a content hash. All NULL for agent-extracted artifacts.
  original_filename TEXT,
  mime       TEXT,
  blob_path  TEXT,
  byte_size  INTEGER,
  content_sha256 TEXT,
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
CREATE INDEX IF NOT EXISTS idx_spaces_project ON spaces(project_id);
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
    // Artifacts the user attached to a branch's context (JSON id array,
    // same convention as pins).
    if (!branchCols.find((c: any) => c.name === "selected_artifacts")) {
      this.db.exec("ALTER TABLE branches ADD COLUMN selected_artifacts TEXT DEFAULT '[]'");
    }
    const msgCols = this.db.prepare("PRAGMA table_info(messages)").all() as any[];
    if (!msgCols.find((c: any) => c.name === "model")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN model TEXT");
    }
    if (!msgCols.find((c: any) => c.name === "user_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN user_id TEXT");
    }
    // Tool activity of the turn that produced an assistant message (JSON
    // [{name, success}]) — persisted so the chat page can keep showing what
    // the assistant did, not just what it said.
    if (!msgCols.find((c: any) => c.name === "tool_calls")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT");
    }
    // Images attached to a user turn (JSON [{blobPath, mediaType, filename}]).
    if (!msgCols.find((c: any) => c.name === "images")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN images TEXT");
    }
    // Upload support: uploaded artifacts carry file provenance alongside their
    // extracted text. Pre-upload rows are all agent-extracted (source defaults
    // to 'extracted'); the rest stay NULL for them. Migrated columns, so no
    // index in the SCHEMA block.
    const artifactCols = this.db.prepare("PRAGMA table_info(artifacts)").all() as any[];
    for (const [col, ddl] of [
      ["source", "TEXT DEFAULT 'extracted'"],
      ["original_filename", "TEXT"],
      ["mime", "TEXT"],
      ["blob_path", "TEXT"],
      ["byte_size", "INTEGER"],
      ["content_sha256", "TEXT"],
    ] as const) {
      if (!artifactCols.find((c: any) => c.name === col)) {
        this.db.exec(`ALTER TABLE artifacts ADD COLUMN ${col} ${ddl}`);
      }
    }
    const orgCols = this.db.prepare("PRAGMA table_info(organisations)").all() as any[];
    if (!orgCols.find((c: any) => c.name === "api_keys")) {
      this.db.exec("ALTER TABLE organisations ADD COLUMN api_keys TEXT");
    }
    const projectCols = this.db.prepare("PRAGMA table_info(projects)").all() as any[];
    if (!projectCols.find((c: any) => c.name === "deleted_at")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN deleted_at REAL");
    }
    if (!projectCols.find((c: any) => c.name === "sort_order")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER");
    }
    for (const col of ["icon", "description", "system_prompt"]) {
      if (!projectCols.find((c: any) => c.name === col)) {
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`);
      }
    }
    // Backfill: creation time preserves the existing order and keeps sorting
    // stable for rows created before ordering existed. New rows get their
    // created_at too, so they append after any explicitly reordered 0..n run.
    this.db.exec("UPDATE projects SET sort_order = CAST(created_at AS INTEGER) WHERE sort_order IS NULL");
    const spaceCols = this.db.prepare("PRAGMA table_info(spaces)").all() as any[];
    if (!spaceCols.find((c: any) => c.name === "deleted_at")) {
      this.db.exec("ALTER TABLE spaces ADD COLUMN deleted_at REAL");
    }
    const chatCols = this.db.prepare("PRAGMA table_info(chats)").all() as any[];
    if (!chatCols.find((c: any) => c.name === "space_id")) {
      this.db.exec("ALTER TABLE chats ADD COLUMN space_id TEXT REFERENCES spaces(id)");
    }
    if (!chatCols.find((c: any) => c.name === "deleted_at")) {
      this.db.exec("ALTER TABLE chats ADD COLUMN deleted_at REAL");
    }
    // Pre-existing chats keep their names: the flag marks only chats born
    // without a user-typed name, awaiting a generated title.
    if (!chatCols.find((c: any) => c.name === "auto_name")) {
      this.db.exec("ALTER TABLE chats ADD COLUMN auto_name INTEGER DEFAULT 0");
    }
    // Index lives here, not in SCHEMA: on a pre-spaces DB the schema pass runs
    // before the ALTER above, and indexing a column that doesn't exist yet
    // kills the whole Store constructor.
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_chats_space ON chats(space_id)");
    // Backfill: chats that predate spaces move into their project's default space.
    const orphanProjects = this.db
      .prepare("SELECT DISTINCT project_id FROM chats WHERE space_id IS NULL")
      .all() as any[];
    for (const row of orphanProjects) {
      const space = this.ensureDefaultSpace(row.project_id);
      this.db
        .prepare("UPDATE chats SET space_id = ? WHERE project_id = ? AND space_id IS NULL")
        .run(space.id, row.project_id);
    }
    // Backfill the "every chat has a trunk" invariant: live chats with no live
    // branches (pre-auto-main chats, or chats whose branches were all deleted)
    // get a fresh empty "main" so they're usable. Model resolves to the
    // configured default at runtime.
    const branchless = this.db
      .prepare("SELECT id FROM chats WHERE deleted_at IS NULL AND id NOT IN (SELECT DISTINCT chat_id FROM branches WHERE chat_id IS NOT NULL AND deleted_at IS NULL)")
      .all() as any[];
    for (const row of branchless) {
      this.createBranch("main", "", undefined, undefined, row.id);
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

  renameOrganisation(id: string, name: string): void {
    this.db.prepare("UPDATE organisations SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /**
   * Every project row of the org — soft-deleted ones included. Org deletion
   * iterates this (not listProjects) so rows left over from the soft-delete
   * era get purged too; otherwise their org_id FK blocks the org row delete.
   */
  listProjectIds(orgId: string): string[] {
    return (this.db.prepare("SELECT id FROM projects WHERE org_id = ?").all(orgId) as any[])
      .map(r => r.id);
  }

  /**
   * Hard-delete an organisation row and its memberships. Callers must have
   * emptied it first (hard-deleting each project via listProjectIds);
   * refuses while any project row remains — live or soft-deleted — and
   * callers should refuse to delete the last organisation.
   */
  deleteOrganisation(id: string): boolean {
    const org = this.getOrganisation(id);
    if (!org) return false;
    if (this.listProjectIds(id).length) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM team_members WHERE org_id = ?").run(id);
      this.db.prepare("DELETE FROM organisations WHERE id = ?").run(id);
    })();
    return true;
  }

  /** Org-scoped API keys ({provider: key}) — override the global config keys. */
  getOrgApiKeys(id: string): Record<string, string> {
    const row = this.db.prepare("SELECT api_keys FROM organisations WHERE id = ?").get(id) as any;
    if (!row?.api_keys) return {};
    try {
      return JSON.parse(row.api_keys) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Merge a patch into an org's API keys, mirroring saveConfig's semantics:
   * `null` clears a key, empty strings are ignored (so a form can submit all
   * fields without wiping saved keys), non-empty values are set.
   */
  setOrgApiKeys(id: string, patch: Record<string, string | null>): void {
    const keys = this.getOrgApiKeys(id);
    for (const [provider, value] of Object.entries(patch)) {
      if (value === null) delete keys[provider];
      else if (typeof value === "string" && value.trim()) keys[provider] = value.trim();
    }
    this.db.prepare("UPDATE organisations SET api_keys = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(keys), Date.now(), id);
  }

  // ── Projects ───────────────────────────────────────────────────────────────

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

  // ── Spaces ─────────────────────────────────────────────────────────────────

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
  private ensureDefaultSpace(projectId: string): Space {
    const existing = this.listSpaces(projectId);
    if (existing.length) return existing[0];
    return this.createSpace(projectId, "General");
  }

  // ── Chats ──────────────────────────────────────────────────────────────────

  createChat(projectId: string, name: string, spaceId?: string, mainBranchModel?: string, autoName = false): Chat {
    const space = spaceId ?? this.ensureDefaultSpace(projectId).id;
    const c: Chat = { id: randomUUID(), projectId, spaceId: space, name, createdAt: Date.now(), autoName };
    this.db.prepare("INSERT INTO chats (id, project_id, space_id, name, auto_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.id, c.projectId, c.spaceId, c.name, autoName ? 1 : 0, c.createdAt, c.createdAt);
    // Every chat is born on its trunk: a "main" branch, git-style, so there is
    // never an unusable branchless chat. An empty model string is fine — the
    // chat runtime falls back to the configured default model.
    this.createBranch("main", mainBranchModel ?? "", undefined, undefined, c.id);
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

  // ── Branches ───────────────────────────────────────────────────────────────

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

  // ── Messages ───────────────────────────────────────────────────────────────

  addMessage(branchId: string, role: string, content: string, model?: string, toolCalls?: Array<{ name: string; success: boolean }>, images?: MessageImage[]): Message {
    // Use MAX(turn)+1 to avoid reuse after undo
    const row = this.db.prepare("SELECT MAX(turn) as maxTurn FROM messages WHERE branch_id = ?").get(branchId) as any;
    const turn = (row?.maxTurn ?? -1) + 1;
    const msg: Message = {
      id: randomUUID(),
      role: role as Message["role"],
      content,
      turn,
      timestamp: Date.now(),
      toolCalls,
      images: images?.length ? images : undefined,
    };
    this.db.prepare(
      `INSERT INTO messages (id, branch_id, role, content, model, turn, timestamp, tool_calls, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(msg.id, branchId, msg.role, msg.content, model ?? null, msg.turn, msg.timestamp, toolCalls?.length ? JSON.stringify(toolCalls) : null, images?.length ? JSON.stringify(images) : null);
    return msg;
  }

  getMessages(branchId: string): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE branch_id = ? ORDER BY turn").all(branchId) as any[];
    return rows.map(r => {
      let toolCalls: Message["toolCalls"];
      if (r.tool_calls) {
        try { toolCalls = JSON.parse(r.tool_calls); } catch { /* corrupt row — show the message without activity */ }
      }
      let images: Message["images"];
      if (r.images) {
        try { images = JSON.parse(r.images); } catch { /* corrupt row — show the message without its images */ }
      }
      return { id: r.id, role: r.role, content: r.content, turn: r.turn, timestamp: r.timestamp, model: r.model ?? undefined, toolCalls, images };
    });
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

  /**
   * Persist a user-uploaded file as an artifact. The caller passes an explicit
   * `id` so the original bytes can be written to blobs/<id> BEFORE this row
   * exists — a failed blob write then leaves no dangling row, and a failed row
   * insert leaves only an orphan blob (swept later), never a row pointing at
   * nothing. `blobPath` is null when the extracted text IS the whole original
   * (plain-text uploads keep no separate copy).
   */
  createUploadedArtifact(fields: {
    id: string;
    branchId: string;
    projectId: string;
    type: string;
    title: string;
    content: string;
    originalFilename: string;
    mime: string;
    blobPath: string | null;
    byteSize: number;
    sha256: string;
  }): any {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO artifacts (id, branch_id, project_id, type, title, content, version, source, original_filename, mime, blob_path, byte_size, content_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'upload', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fields.id, fields.branchId, fields.projectId, fields.type, fields.title, fields.content,
      fields.originalFilename, fields.mime, fields.blobPath, fields.byteSize, fields.sha256, now, now,
    );
    return { id: fields.id, branchId: fields.branchId, projectId: fields.projectId, type: fields.type, title: fields.title, version: 1, createdAt: now };
  }

  /** Live uploaded artifact on this branch with these exact bytes, if any —
   * lets upload attach the existing artifact instead of duplicating it. */
  findUploadedArtifactBySha(branchId: string, sha256: string): { id: string; title: string } | undefined {
    const row = this.db.prepare(
      "SELECT id, title FROM artifacts WHERE branch_id = ? AND content_sha256 = ? AND deleted_at IS NULL LIMIT 1"
    ).get(branchId, sha256) as any;
    return row ? { id: row.id, title: row.title } : undefined;
  }

  /** Every blobs/<file> path some row still references (message images and
   * uploaded artifacts). Soft-deleted rows count as references — their blobs
   * must survive an undelete. Drives the startup orphan-blob sweep. */
  referencedBlobPaths(): Set<string> {
    const paths = new Set<string>();
    for (const r of this.db.prepare("SELECT blob_path FROM artifacts WHERE blob_path IS NOT NULL").all() as any[]) {
      paths.add(r.blob_path);
    }
    for (const r of this.db.prepare("SELECT images FROM messages WHERE images IS NOT NULL").all() as any[]) {
      try {
        for (const im of JSON.parse(r.images)) if (im?.blobPath) paths.add(im.blobPath);
      } catch { /* corrupt row — its images are unrenderable anyway */ }
    }
    return paths;
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
    return { id: row.id, branchId: row.branch_id, projectId: row.project_id, type: row.type, title: row.title, content: row.content, version: row.version, source: row.source ?? "extracted", originalFilename: row.original_filename ?? null, mime: row.mime ?? null, blobPath: row.blob_path ?? null, byteSize: row.byte_size ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listArtifacts(projectId: string): any[] {
    return (this.db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC").all(projectId) as any[])
      .map(r => ({ id: r.id, branchId: r.branch_id, projectId: r.project_id, type: r.type, title: r.title, version: r.version, source: r.source ?? "extracted", createdAt: r.created_at, updatedAt: r.updated_at }));
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
    // createChat gives the chat its "main" trunk; adopt any orphaned
    // pre-chats-era branches into it.
    const chat = this.createChat(project.id, "General", undefined, defaultModel);
    for (const b of this.listBranches()) {
      if (!b.chatId) {
        this.db.prepare("UPDATE branches SET chat_id = ? WHERE id = ?").run(chat.id, b.id);
      }
    }
  }
}
