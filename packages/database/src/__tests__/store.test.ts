import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { Store } from "../store.js";

let tmpDir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "store-test-"));
  dbPath = join(tmpDir, "test.db");
  store = new Store(dbPath);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Organisations ────────────────────────────────────────────────────────────

describe("Organisation CRUD", () => {
  it("createOrganisation → getOrganisation returns same data", () => {
    const org = store.createOrganisation("Acme Corp");
    const fetched = store.getOrganisation(org.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Acme Corp");
    expect(fetched!.id).toBe(org.id);
  });

  it("listOrganisations includes created org", () => {
    const org = store.createOrganisation("My Org");
    const list = store.listOrganisations();
    expect(list.some(o => o.id === org.id)).toBe(true);
  });

  it("getOrganisation returns undefined for unknown id", () => {
    expect(store.getOrganisation("nonexistent")).toBeUndefined();
  });

  it("renameOrganisation updates the name", () => {
    const org = store.createOrganisation("Old");
    store.renameOrganisation(org.id, "New");
    expect(store.getOrganisation(org.id)!.name).toBe("New");
  });

  it("org API keys: set merges, empty is ignored, null clears", () => {
    const org = store.createOrganisation("Org");
    expect(store.getOrgApiKeys(org.id)).toEqual({});

    store.setOrgApiKeys(org.id, { anthropic: "sk-a", openai: "sk-o" });
    expect(store.getOrgApiKeys(org.id)).toEqual({ anthropic: "sk-a", openai: "sk-o" });

    // Empty strings don't wipe saved keys; null does.
    store.setOrgApiKeys(org.id, { anthropic: "", openai: null, google: " sk-g " });
    expect(store.getOrgApiKeys(org.id)).toEqual({ anthropic: "sk-a", google: "sk-g" });
  });

  it("deleteOrganisation removes an emptied org but refuses one with projects", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "P");
    expect(store.deleteOrganisation(org.id)).toBe(false); // still has a project
    store.deleteProject(project.id);
    expect(store.deleteOrganisation(org.id)).toBe(true);
    expect(store.getOrganisation(org.id)).toBeUndefined();
    expect(store.deleteOrganisation(org.id)).toBe(false); // already gone
  });

  it("org deletion copes with soft-delete-era project rows (FK regression)", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Legacy");
    // Simulate a row left over from when project deletion was soft.
    const raw = new Database(dbPath);
    raw.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").run(Date.now(), project.id);
    raw.close();
    expect(store.listProjects(org.id)).toEqual([]); // invisible to the UI…
    expect(store.listProjectIds(org.id)).toEqual([project.id]); // …but the purge sees it

    // hardDeleteProject path: deleteProject must accept the soft-deleted row.
    expect(store.deleteProject(project.id)).not.toBeNull();
    // The org row delete no longer trips the projects.org_id FK.
    expect(store.deleteOrganisation(org.id)).toBe(true);
  });
});

// ── Projects ─────────────────────────────────────────────────────────────────

describe("Project CRUD", () => {
  it("createProject → getProject returns same data", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "My Project");
    const fetched = store.getProject(project.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("My Project");
    expect(fetched!.orgId).toBe(org.id);
  });

  it("listProjects returns projects for the org", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "P1");
    const list = store.listProjects(org.id);
    expect(list.some(p => p.id === project.id)).toBe(true);
  });

  it("renameProject updates the name", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Old");
    store.renameProject(project.id, "New");
    expect(store.getProject(project.id)!.name).toBe("New");
  });

  it("moveProject reassigns the org and appends at the target's end", () => {
    const orgA = store.createOrganisation("A");
    const orgB = store.createOrganisation("B");
    const existing = store.createProject(orgB.id, "Existing");
    const moved = store.createProject(orgA.id, "Moved");

    store.moveProject(moved.id, orgB.id);
    expect(store.getProject(moved.id)!.orgId).toBe(orgB.id);
    expect(store.listProjects(orgA.id)).toEqual([]);
    expect(store.listProjects(orgB.id).map(p => p.id)).toEqual([existing.id, moved.id]);
  });

  it("updateProject patches only the given fields", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "P");
    store.updateProject(project.id, { description: "About P", systemPrompt: "Be terse." });
    let fetched = store.getProject(project.id)!;
    expect(fetched.name).toBe("P");
    expect(fetched.description).toBe("About P");
    expect(fetched.systemPrompt).toBe("Be terse.");

    store.updateProject(project.id, { icon: "data:image/png;base64,AAAA", name: "P2" });
    fetched = store.getProject(project.id)!;
    expect(fetched.icon).toBe("data:image/png;base64,AAAA");
    expect(fetched.name).toBe("P2");
    expect(fetched.description).toBe("About P"); // untouched

    store.updateProject(project.id, { icon: null }); // explicit removal
    expect(store.getProject(project.id)!.icon).toBeNull();

    store.updateProject(project.id, {}); // no-op patch doesn't throw
    expect(store.getProject(project.id)!.name).toBe("P2");
  });

  it("reorderProjects persists the order; new projects append after it", () => {
    const org = store.createOrganisation("Org");
    const a = store.createProject(org.id, "A");
    const b = store.createProject(org.id, "B");
    const c = store.createProject(org.id, "C");

    store.reorderProjects(org.id, [c.id, a.id, b.id]);
    expect(store.listProjects(org.id).map(p => p.id)).toEqual([c.id, a.id, b.id]);

    // A project created after a reorder sorts last (creation-time sort_order
    // is far above the rewritten 0..n run).
    const d = store.createProject(org.id, "D");
    expect(store.listProjects(org.id).map(p => p.id)).toEqual([c.id, a.id, b.id, d.id]);
  });

  it("projectImpact counts live spaces, chats and artifacts", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Design");
    const chat = store.createChat(project.id, "Chat", space.id);
    const branch = store.listBranches(chat.id)[0]!; // auto-created main
    store.createArtifact(branch.id, project.id, "doc", "Doc", "content");

    const impact = store.projectImpact(project.id);
    expect(impact.spaceIds).toEqual([space.id]);
    expect(impact.chatIds).toEqual([chat.id]);
    expect(impact.branchIds).toEqual([branch.id]);
    expect(impact.artifacts).toBe(1);
  });

  it("deleteProject HARD-deletes everything, soft-deleted rows included", () => {
    const org = store.createOrganisation("Org");
    const keep = store.createProject(org.id, "Kept");
    const doomed = store.createProject(org.id, "Doomed");
    const space = store.createSpace(doomed.id, "Design");
    const chat = store.createChat(doomed.id, "Chat", space.id);
    const branch = store.listBranches(chat.id)[0]!;
    store.addMessage(branch.id, "user", "hello");
    store.createArtifact(branch.id, doomed.id, "doc", "Doc", "content");
    // A chat soft-deleted beforehand must be purged too.
    const softDeleted = store.createChat(doomed.id, "Old", space.id);
    store.deleteChat(softDeleted.id);

    const purged = store.deleteProject(doomed.id);
    expect(purged).not.toBeNull();
    expect(purged!.chatIds.sort()).toEqual([chat.id, softDeleted.id].sort());
    expect(purged!.branchIds).toContain(branch.id);

    expect(store.getProject(doomed.id)).toBeUndefined();
    expect(store.listProjects(org.id).map(p => p.id)).toEqual([keep.id]);
    // Rows are physically gone — not soft-deleted.
    const raw = new Database(dbPath);
    const count = (sql: string, param: string) =>
      (raw.prepare(sql).get(param) as any).n as number;
    expect(count("SELECT COUNT(*) AS n FROM projects WHERE id = ?", doomed.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM spaces WHERE project_id = ?", doomed.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM chats WHERE project_id = ?", doomed.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM branches WHERE id = ?", branch.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM messages WHERE branch_id = ?", branch.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?", doomed.id)).toBe(0);
    raw.close();

    // Repeat and unknown deletes report null.
    expect(store.deleteProject(doomed.id)).toBeNull();
    expect(store.deleteProject("nonexistent")).toBeNull();
  });
});

// ── Spaces ────────────────────────────────────────────────────────────────────

describe("Space CRUD", () => {
  it("createSpace → getSpace/listSpaces returns same data", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Design");
    expect(store.getSpace(space.id)!.name).toBe("Design");
    expect(store.listSpaces(project.id).some(s => s.id === space.id)).toBe(true);
  });

  it("createChat without spaceId auto-assigns the project's default space", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Chat");
    expect(chat.spaceId).toBeDefined();
    const spaces = store.listSpaces(project.id);
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.name).toBe("General");
    expect(chat.spaceId).toBe(spaces[0]!.id);
  });

  it("createChat with explicit spaceId uses it", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Dev");
    const chat = store.createChat(project.id, "Chat", space.id);
    expect(store.getChat(chat.id)!.spaceId).toBe(space.id);
  });

  it("createChat auto-creates a 'main' trunk branch carrying the given model", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Chat", undefined, "gpt-4");
    const branches = store.listBranches(chat.id);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("main");
    expect(branches[0]!.model).toBe("gpt-4");
  });

  it("renameSpace updates the name", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Desgin");
    store.renameSpace(space.id, "Design");
    expect(store.getSpace(space.id)!.name).toBe("Design");
  });

  it("deleteSpace soft-deletes the space with its chats, branches and artifacts", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const keep = store.createSpace(project.id, "Design");
    const doomed = store.createSpace(project.id, "Scratch");
    const keptChat = store.createChat(project.id, "Kept chat", keep.id);
    const chat = store.createChat(project.id, "Chat", doomed.id);
    const branch = store.createBranch("main", "model", undefined, undefined, chat.id);
    const artifact = store.createArtifact(branch.id, project.id, "doc", "Doc", "content");

    expect(store.deleteSpace(doomed.id)).toBe(true);
    expect(store.getSpace(doomed.id)).toBeUndefined();
    expect(store.getChat(chat.id)).toBeUndefined();
    expect(store.getBranch(branch.id)).toBeUndefined();
    expect(store.getArtifact(artifact.id)).toBeUndefined();
    // Rows survive as soft-deleted — "git for context" doesn't destroy context.
    const raw = new Database(dbPath);
    expect((raw.prepare("SELECT deleted_at FROM spaces WHERE id = ?").get(doomed.id) as any).deleted_at).not.toBeNull();
    expect((raw.prepare("SELECT deleted_at FROM chats WHERE id = ?").get(chat.id) as any).deleted_at).not.toBeNull();
    raw.close();
    // The neighbouring space is untouched.
    expect(store.getSpace(keep.id)).toBeDefined();
    expect(store.getChat(keptChat.id)!.spaceId).toBe(keep.id);
  });

  it("deleteSpace can delete a project's last space; General comes back on demand", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const only = store.createSpace(project.id, "General");
    expect(store.deleteSpace(only.id)).toBe(true);
    expect(store.listSpaces(project.id)).toEqual([]);
    // A chat created afterwards recreates the default space.
    const chat = store.createChat(project.id, "Chat");
    const spaces = store.listSpaces(project.id);
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.name).toBe("General");
    expect(chat.spaceId).toBe(spaces[0]!.id);
  });

  it("deleteSpace returns false for unknown or already-deleted spaces", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Scratch");
    expect(store.deleteSpace("nonexistent")).toBe(false);
    expect(store.deleteSpace(space.id)).toBe(true);
    expect(store.deleteSpace(space.id)).toBe(false);
  });

  it("spaceImpact counts live chats and artifacts, including those on soft-deleted branches", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const space = store.createSpace(project.id, "Design");
    const chatA = store.createChat(project.id, "A", space.id);
    const chatB = store.createChat(project.id, "B", space.id);
    const live = store.createBranch("main", "model", undefined, undefined, chatA.id);
    const dead = store.createBranch("old", "model", undefined, undefined, chatB.id);
    store.createArtifact(live.id, project.id, "doc", "Doc", "content");
    // An artifact on a soft-deleted branch is still listed at project level,
    // so deleting the space sweeps it — impact must count it.
    store.createArtifact(dead.id, project.id, "doc", "Old doc", "content");
    store.deleteBranch(dead.id);

    const impact = store.spaceImpact(space.id);
    expect(impact.chatIds.sort()).toEqual([chatA.id, chatB.id].sort());
    // live + dead + each chat's auto-created "main" trunk.
    expect(impact.branchIds).toHaveLength(4);
    expect(impact.branchIds).toContain(live.id);
    expect(impact.branchIds).toContain(dead.id);
    expect(impact.artifacts).toBe(2);

    // A previously deleted chat no longer counts.
    store.deleteChat(chatB.id);
    const after = store.spaceImpact(space.id);
    expect(after.chatIds).toEqual([chatA.id]);
    expect(after.artifacts).toBe(1);
  });
});

// ── Migration from a pre-spaces database ─────────────────────────────────────

describe("pre-spaces migration", () => {
  it("opens a legacy DB, adds space_id, and backfills chats into General", () => {
    const legacyPath = join(tmpDir, "legacy.db");

    // Recreate the old schema by hand: chats without space_id, no spaces table.
    const raw = new Database(legacyPath);
    raw.exec(`
      CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at REAL, updated_at REAL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL, updated_at REAL);
      CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL, updated_at REAL);
    `);
    raw.prepare("INSERT INTO organisations VALUES ('o1', 'Org', 1, 1)").run();
    raw.prepare("INSERT INTO projects VALUES ('p1', 'o1', 'Project', 1, 1)").run();
    raw.prepare("INSERT INTO chats VALUES ('c1', 'p1', 'Old chat', 1, 1)").run();
    raw.prepare("INSERT INTO chats VALUES ('c2', 'p1', 'Older chat', 2, 2)").run();
    raw.close();

    // Constructing the Store runs schema + migrate; this used to throw
    // "no such column: space_id" because an index on chats(space_id) sat in
    // the schema pass, ahead of the ALTER TABLE.
    const migrated = new Store(legacyPath);
    const spaces = migrated.listSpaces("p1");
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.name).toBe("General");
    for (const chat of migrated.listChats("p1")) {
      expect(chat.spaceId).toBe(spaces[0]!.id);
      // Branchless legacy chats get a "main" trunk backfilled.
      const branches = migrated.listBranches(chat.id);
      expect(branches).toHaveLength(1);
      expect(branches[0]!.name).toBe("main");
    }
  });

  it("reopening a store recreates a trunk for chats whose branches were all deleted", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Chat");
    for (const b of store.listBranches(chat.id)) store.deleteBranch(b.id);
    expect(store.listBranches(chat.id)).toHaveLength(0);

    const reopened = new Store(dbPath);
    const branches = reopened.listBranches(chat.id);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("main");
  });
});

// ── Chats ─────────────────────────────────────────────────────────────────────

describe("Chat CRUD", () => {
  it("createChat → getChat returns same data", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "General");
    const fetched = store.getChat(chat.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("General");
    expect(fetched!.projectId).toBe(project.id);
  });

  it("listChats returns chats for the project", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Chat1");
    const list = store.listChats(project.id);
    expect(list.some(c => c.id === chat.id)).toBe(true);
  });

  it("renameChat updates the name", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Old name");
    store.renameChat(chat.id, "New name");
    expect(store.getChat(chat.id)!.name).toBe("New name");
  });

  it("deleteChat soft-deletes the chat, its branches and their artifacts", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Doomed");
    const branch = store.createBranch("main", "gpt-4", undefined, undefined, chat.id);
    const artifact = store.createArtifact(branch.id, project.id, "doc", "Doc", "content");
    expect(store.deleteChat(chat.id)).toBe(true);
    expect(store.getChat(chat.id)).toBeUndefined();
    expect(store.getBranch(branch.id)).toBeUndefined();
    expect(store.getArtifact(artifact.id)).toBeUndefined();
    expect(store.listChats(project.id).some(c => c.id === chat.id)).toBe(false);
  });

  it("deleteChat returns false for unknown id", () => {
    expect(store.deleteChat("nonexistent")).toBe(false);
  });

  it("chatImpact counts live branches and artifacts; purge ids include soft-deleted branches", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "Project");
    const chat = store.createChat(project.id, "Chat");
    const live = store.createBranch("main", "model", undefined, undefined, chat.id);
    const dead = store.createBranch("old", "model", undefined, undefined, chat.id);
    store.createArtifact(live.id, project.id, "doc", "Doc", "content");
    // Still listed at project level despite its branch being soft-deleted, so
    // deleting the chat sweeps it — impact must count it.
    store.createArtifact(dead.id, project.id, "doc", "Old doc", "content");
    store.deleteBranch(dead.id);

    const impact = store.chatImpact(chat.id);
    // live + dead + the auto-created "main" trunk.
    expect(impact.branchIds).toHaveLength(3);
    expect(impact.branchIds).toContain(live.id);
    expect(impact.branchIds).toContain(dead.id);
    expect(impact.branches).toBe(2);
    expect(impact.artifacts).toBe(2);
  });
});

// ── Branches ──────────────────────────────────────────────────────────────────

describe("Branch CRUD", () => {
  it("createBranch → getBranch by id", () => {
    const branch = store.createBranch("main", "gpt-4");
    const fetched = store.getBranch(branch.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("main");
    expect(fetched!.model).toBe("gpt-4");
  });

  it("getBranchByName returns branch by name", () => {
    store.createBranch("feature-x", "gpt-4");
    const fetched = store.getBranchByName("feature-x");
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("feature-x");
  });

  it("listBranches returns created branches", () => {
    const org = store.createOrganisation("Org");
    const project = store.createProject(org.id, "P");
    const chat = store.createChat(project.id, "C");
    store.createBranch("main", "gpt-4", undefined, undefined, chat.id);
    const branches = store.listBranches(chat.id);
    expect(branches.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteBranch soft-deletes — getBranch returns undefined after", () => {
    const branch = store.createBranch("to-delete", "gpt-4");
    expect(store.deleteBranch(branch.id)).toBe(true);
    expect(store.getBranch(branch.id)).toBeUndefined();
  });

  it("deleteBranch reassigns children to grandparent", () => {
    const parent = store.createBranch("parent", "gpt-4");
    const child = store.createBranch("child", "gpt-4", parent.id);
    const grandchild = store.createBranch("grandchild", "gpt-4", child.id);

    store.deleteBranch(child.id);

    // grandchild should now point to parent
    const gc = store.getBranch(grandchild.id);
    expect(gc!.parentId).toBe(parent.id);
  });

  it("updateBranchModel changes the model", () => {
    const branch = store.createBranch("b", "gpt-4");
    store.updateBranchModel(branch.id, "claude-3");
    const updated = store.getBranch(branch.id);
    expect(updated!.model).toBe("claude-3");
  });

  it("addPin / removePin work correctly", () => {
    const branch = store.createBranch("b", "gpt-4");
    store.addPin(branch.id, "Important note");
    const withPin = store.getBranch(branch.id);
    expect(withPin!.pins).toContain("Important note");

    const removed = store.removePin(branch.id, 0);
    expect(removed).toBe(true);
    const afterRemove = store.getBranch(branch.id);
    expect(afterRemove!.pins).toHaveLength(0);
  });

  it("removePin returns false when index is out of bounds", () => {
    const branch = store.createBranch("b", "gpt-4");
    expect(store.removePin(branch.id, 5)).toBe(false);
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────

describe("Messages", () => {
  let branchId: string;

  beforeEach(() => {
    branchId = store.createBranch("msg-branch", "gpt-4").id;
  });

  it("addMessage auto-increments turn starting from 0", () => {
    const m0 = store.addMessage(branchId, "user", "hello");
    const m1 = store.addMessage(branchId, "assistant", "hi");
    const m2 = store.addMessage(branchId, "user", "follow-up");
    expect(m0.turn).toBe(0);
    expect(m1.turn).toBe(1);
    expect(m2.turn).toBe(2);
  });

  it("getMessages returns messages in turn order", () => {
    store.addMessage(branchId, "user", "first");
    store.addMessage(branchId, "assistant", "second");
    const msgs = store.getMessages(branchId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.turn).toBeLessThan(msgs[1]!.turn);
    expect(msgs[0]!.content).toBe("first");
  });

  it("deleteLastMessage removes the last message", () => {
    store.addMessage(branchId, "user", "first");
    store.addMessage(branchId, "assistant", "last");
    expect(store.deleteLastMessage(branchId)).toBe(true);
    expect(store.getMessages(branchId)).toHaveLength(1);
    expect(store.getMessages(branchId)[0]!.content).toBe("first");
  });

  it("undoLastTurn removes assistant + preceding user pair", () => {
    store.addMessage(branchId, "user", "question");
    store.addMessage(branchId, "assistant", "answer");
    const removed = store.undoLastTurn(branchId);
    expect(removed).toBe(2);
    expect(store.getMessages(branchId)).toHaveLength(0);
  });

  it("getMessageCount returns correct count", () => {
    store.addMessage(branchId, "user", "a");
    store.addMessage(branchId, "assistant", "b");
    expect(store.getMessageCount(branchId)).toBe(2);
  });

  it("editMessage deletes the target turn and everything after it", () => {
    store.addMessage(branchId, "user", "original question");
    store.addMessage(branchId, "assistant", "original answer");
    store.addMessage(branchId, "user", "follow-up");
    store.addMessage(branchId, "assistant", "follow-up answer");

    store.editMessage(branchId, 0);

    const msgs = store.getMessages(branchId);
    expect(msgs).toHaveLength(0);
  });

  it("editMessage is a no-op when there's no message at that turn", () => {
    store.addMessage(branchId, "user", "only message");
    store.editMessage(branchId, 5);
    const msgs = store.getMessages(branchId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("only message");
  });

  it("deleteMessagePair removes a user message and its paired assistant response", () => {
    store.addMessage(branchId, "user", "question");
    store.addMessage(branchId, "assistant", "answer");
    store.addMessage(branchId, "user", "second question");
    store.addMessage(branchId, "assistant", "second answer");

    const removed = store.deleteMessagePair(branchId, 0);

    expect(removed).toBe(2);
    const msgs = store.getMessages(branchId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toBe("second question");
  });

  it("deleteMessagePair removes only the target message when there's no paired response", () => {
    store.addMessage(branchId, "user", "lone question");
    const removed = store.deleteMessagePair(branchId, 0);
    expect(removed).toBe(1);
    expect(store.getMessages(branchId)).toHaveLength(0);
  });

  it("deleteMessagePair does not delete the next message if it isn't an assistant reply", () => {
    // Two consecutive user messages (e.g. after some edge case) — deleting
    // the first must not delete the second just because it's "next".
    store.addMessage(branchId, "user", "first");
    store.addMessage(branchId, "user", "second (also user)");
    const removed = store.deleteMessagePair(branchId, 0);
    expect(removed).toBe(1);
    const msgs = store.getMessages(branchId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("second (also user)");
  });

  it("deleteMessagePair returns 0 when there's no message at that turn", () => {
    store.addMessage(branchId, "user", "only message");
    const removed = store.deleteMessagePair(branchId, 99);
    expect(removed).toBe(0);
    expect(store.getMessages(branchId)).toHaveLength(1);
  });
});

// ── Summaries ─────────────────────────────────────────────────────────────────

describe("Summaries", () => {
  let branchId: string;

  beforeEach(() => {
    branchId = store.createBranch("sum-branch", "gpt-4").id;
  });

  it("addSummary / getSummaries round-trip", () => {
    store.addSummary(branchId, 0, 5, "Summary text");
    const summaries = store.getSummaries(branchId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.content).toBe("Summary text");
    expect(summaries[0]!.fromTurn).toBe(0);
    expect(summaries[0]!.toTurn).toBe(5);
  });

  it("replaceSummaries replaces existing summaries", () => {
    store.addSummary(branchId, 0, 5, "Old summary");
    store.replaceSummaries(branchId, [
      { branchId, fromTurn: 0, toTurn: 10, content: "New summary", timestamp: Date.now() },
    ]);
    const summaries = store.getSummaries(branchId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.content).toBe("New summary");
  });
});

// ── Artifacts ─────────────────────────────────────────────────────────────────

describe("Artifacts", () => {
  let branchId: string;
  let projectId: string;

  beforeEach(() => {
    const org = store.createOrganisation("Org");
    projectId = store.createProject(org.id, "P").id;
    const chat = store.createChat(projectId, "C");
    branchId = store.createBranch("art-branch", "gpt-4", undefined, undefined, chat.id).id;
  });

  it("createArtifact / getArtifact round-trip", () => {
    const a = store.createArtifact(branchId, projectId, "code", "My Script", "console.log('hi')");
    const fetched = store.getArtifact(a.id);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe("My Script");
    expect(fetched!.content).toBe("console.log('hi')");
    expect(fetched!.version).toBe(1);
  });

  it("updateArtifact increments version", () => {
    const a = store.createArtifact(branchId, projectId, "code", "Script", "v1");
    store.updateArtifact(a.id, "v2");
    const fetched = store.getArtifact(a.id);
    expect(fetched!.version).toBe(2);
    expect(fetched!.content).toBe("v2");
  });

  it("listArtifacts returns artifacts for project", () => {
    const a = store.createArtifact(branchId, projectId, "code", "Script", "content");
    const list = store.listArtifacts(projectId);
    expect(list.some(x => x.id === a.id)).toBe(true);
  });
});

// ── Costs ─────────────────────────────────────────────────────────────────────

describe("Costs", () => {
  let branchId: string;
  let projectId: string;

  beforeEach(() => {
    const org = store.createOrganisation("Org");
    projectId = store.createProject(org.id, "P").id;
    const chat = store.createChat(projectId, "C");
    branchId = store.createBranch("cost-branch", "gpt-4", undefined, undefined, chat.id).id;
  });

  it("recordCost / getCosts round-trip", () => {
    store.recordCost(branchId, "gpt-4", 100, 50, 0.01);
    const costs = store.getCosts(branchId);
    expect(costs).toHaveLength(1);
    expect(costs[0]!.model).toBe("gpt-4");
    expect(costs[0]!.inputTokens).toBe(100);
    expect(costs[0]!.outputTokens).toBe(50);
    expect(costs[0]!.costUsd).toBeCloseTo(0.01);
  });

  it("getProjectCosts aggregates correctly across branches", () => {
    store.recordCost(branchId, "gpt-4", 100, 50, 0.01);
    store.recordCost(branchId, "gpt-4", 200, 100, 0.02);
    const totals = store.getProjectCosts(projectId);
    expect(totals.totalCost).toBeCloseTo(0.03);
    expect(totals.totalInput).toBe(300);
    expect(totals.totalOutput).toBe(150);
  });
});

// ── Meta ──────────────────────────────────────────────────────────────────────

describe("Meta", () => {
  it("getMeta/setMeta round-trip", () => {
    store.setMeta("foo", "bar");
    expect(store.getMeta("foo")).toBe("bar");
  });

  it("getMeta returns undefined for unknown key", () => {
    expect(store.getMeta("unknown-key")).toBeUndefined();
  });

  it("setMeta overwrites existing value", () => {
    store.setMeta("key", "old");
    store.setMeta("key", "new");
    expect(store.getMeta("key")).toBe("new");
  });

  it("getActiveBranchId / setActiveBranchId round-trip", () => {
    const branch = store.createBranch("active", "gpt-4");
    store.setActiveBranchId(branch.id);
    expect(store.getActiveBranchId()).toBe(branch.id);
  });
});

// ── ensureDefaults ────────────────────────────────────────────────────────────

describe("ensureDefaults", () => {
  it("creates org + project + chat + branch when none exist", () => {
    store.ensureDefaults("gpt-4");
    expect(store.listOrganisations().length).toBeGreaterThanOrEqual(1);
    const orgs = store.listOrganisations();
    const projects = store.listProjects(orgs[0]!.id);
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const chats = store.listChats(projects[0]!.id);
    expect(chats.length).toBeGreaterThanOrEqual(1);
    const branches = store.listBranches(chats[0]!.id);
    expect(branches.length).toBeGreaterThanOrEqual(1);
  });

  it("ensureDefaults is idempotent on second call", () => {
    store.ensureDefaults("gpt-4");
    store.ensureDefaults("gpt-4");
    expect(store.listOrganisations()).toHaveLength(1);
  });
});
