import type Database from "better-sqlite3";

export const SCHEMA = `
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

CREATE TABLE IF NOT EXISTS automations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id),
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  name        TEXT NOT NULL,
  schedule    TEXT NOT NULL,
  task        TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  next_run_at REAL,
  last_run_at REAL,
  last_status TEXT,
  created_at  REAL
);

CREATE INDEX IF NOT EXISTS idx_messages_branch_turn ON messages(branch_id, turn);
CREATE INDEX IF NOT EXISTS idx_automations_branch ON automations(branch_id);
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

/**
 * Column-level migrations (ALTERs, SQL-only backfills, and the one index that
 * can't live in SCHEMA). Runs after the SCHEMA pass; the data backfills that
 * need repository logic stay in Store.migrate, which calls this first.
 */
export function applyMigrations(db: Database.Database): void {
  const branchCols = db.prepare("PRAGMA table_info(branches)").all() as any[];
  if (!branchCols.find((c: any) => c.name === "chat_id")) {
    db.exec("ALTER TABLE branches ADD COLUMN chat_id TEXT REFERENCES chats(id)");
  }
  if (!branchCols.find((c: any) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE branches ADD COLUMN deleted_at REAL");
  }
  if (!branchCols.find((c: any) => c.name === "updated_at")) {
    db.exec("ALTER TABLE branches ADD COLUMN updated_at REAL");
  }
  if (!branchCols.find((c: any) => c.name === "created_by")) {
    db.exec("ALTER TABLE branches ADD COLUMN created_by TEXT");
  }
  // Artifacts the user attached to a branch's context (JSON id array,
  // same convention as pins).
  if (!branchCols.find((c: any) => c.name === "selected_artifacts")) {
    db.exec("ALTER TABLE branches ADD COLUMN selected_artifacts TEXT DEFAULT '[]'");
  }
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as any[];
  if (!msgCols.find((c: any) => c.name === "model")) {
    db.exec("ALTER TABLE messages ADD COLUMN model TEXT");
  }
  if (!msgCols.find((c: any) => c.name === "user_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN user_id TEXT");
  }
  // Tool activity of the turn that produced an assistant message (JSON
  // [{name, success}]) — persisted so the chat page can keep showing what
  // the assistant did, not just what it said.
  if (!msgCols.find((c: any) => c.name === "tool_calls")) {
    db.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT");
  }
  // Images attached to a user turn (JSON [{blobPath, mediaType, filename}]).
  if (!msgCols.find((c: any) => c.name === "images")) {
    db.exec("ALTER TABLE messages ADD COLUMN images TEXT");
  }
  // The model's reasoning for an assistant turn (plain text, capped at
  // persist time) — user-facing visibility, never re-sent to the model.
  if (!msgCols.find((c: any) => c.name === "thinking")) {
    db.exec("ALTER TABLE messages ADD COLUMN thinking TEXT");
  }
  // Upload support: uploaded artifacts carry file provenance alongside their
  // extracted text. Pre-upload rows are all agent-extracted (source defaults
  // to 'extracted'); the rest stay NULL for them. Migrated columns, so no
  // index in the SCHEMA block.
  const artifactCols = db.prepare("PRAGMA table_info(artifacts)").all() as any[];
  for (const [col, ddl] of [
    ["source", "TEXT DEFAULT 'extracted'"],
    ["original_filename", "TEXT"],
    ["mime", "TEXT"],
    ["blob_path", "TEXT"],
    ["byte_size", "INTEGER"],
    ["content_sha256", "TEXT"],
  ] as const) {
    if (!artifactCols.find((c: any) => c.name === col)) {
      db.exec(`ALTER TABLE artifacts ADD COLUMN ${col} ${ddl}`);
    }
  }
  const orgCols = db.prepare("PRAGMA table_info(organisations)").all() as any[];
  if (!orgCols.find((c: any) => c.name === "api_keys")) {
    db.exec("ALTER TABLE organisations ADD COLUMN api_keys TEXT");
  }
  const projectCols = db.prepare("PRAGMA table_info(projects)").all() as any[];
  if (!projectCols.find((c: any) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN deleted_at REAL");
  }
  if (!projectCols.find((c: any) => c.name === "sort_order")) {
    db.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER");
  }
  for (const col of ["icon", "description", "system_prompt"]) {
    if (!projectCols.find((c: any) => c.name === col)) {
      db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`);
    }
  }
  // Backfill: creation time preserves the existing order and keeps sorting
  // stable for rows created before ordering existed. New rows get their
  // created_at too, so they append after any explicitly reordered 0..n run.
  db.exec("UPDATE projects SET sort_order = CAST(created_at AS INTEGER) WHERE sort_order IS NULL");
  const spaceCols = db.prepare("PRAGMA table_info(spaces)").all() as any[];
  if (!spaceCols.find((c: any) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE spaces ADD COLUMN deleted_at REAL");
  }
  const chatCols = db.prepare("PRAGMA table_info(chats)").all() as any[];
  if (!chatCols.find((c: any) => c.name === "space_id")) {
    db.exec("ALTER TABLE chats ADD COLUMN space_id TEXT REFERENCES spaces(id)");
  }
  if (!chatCols.find((c: any) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE chats ADD COLUMN deleted_at REAL");
  }
  // Pre-existing chats keep their names: the flag marks only chats born
  // without a user-typed name, awaiting a generated title.
  if (!chatCols.find((c: any) => c.name === "auto_name")) {
    db.exec("ALTER TABLE chats ADD COLUMN auto_name INTEGER DEFAULT 0");
  }
  // Index lives here, not in SCHEMA: on a pre-spaces DB the schema pass runs
  // before the ALTER above, and indexing a column that doesn't exist yet
  // kills the whole Store constructor.
  db.exec("CREATE INDEX IF NOT EXISTS idx_chats_space ON chats(space_id)");
}
