import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
