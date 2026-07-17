import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GlobalMemory } from "../global_memory.js";

let tmpDir: string;
let memory: GlobalMemory;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "global-memory-test-"));
  memory = new GlobalMemory(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GlobalMemory", () => {
  it("new instance: list() returns []", () => {
    expect(memory.list()).toEqual([]);
  });

  it("add() returns a MemoryFact with id=1 and scope='global'", () => {
    const fact = memory.add("fact1");
    expect(fact.id).toBe(1);
    expect(fact.text).toBe("fact1");
    expect(fact.scope).toBe("global");
    expect(typeof fact.createdAt).toBe("number");
  });

  it("add() with a project scope sets the scope correctly", () => {
    const fact = memory.add("fact2", "project:p1");
    expect(fact.scope).toBe("project:p1");
  });

  describe("dedup on add", () => {
    it("normalized-exact duplicate in the same scope returns the existing fact, no insert", () => {
      const first = memory.add("The user prefers TypeScript.");
      const dup = memory.addWithStatus("  the user   prefers typescript ");
      expect(dup.added).toBe(false);
      expect(dup.fact.id).toBe(first.id);
      expect(memory.list()).toHaveLength(1);
    });

    it("near-duplicate phrasing (Jaccard ≥ 0.85) is skipped", () => {
      memory.add("The user's favorite editor is VS Code with the vim extension enabled");
      const dup = memory.addWithStatus("The user's favorite editor is VS Code with the vim extension");
      expect(dup.added).toBe(false);
      expect(memory.list()).toHaveLength(1);
    });

    it("same text in a DIFFERENT scope is a separate fact", () => {
      memory.add("Prefers dark mode", "project:p1");
      const other = memory.addWithStatus("Prefers dark mode", "project:p2");
      expect(other.added).toBe(true);
      expect(memory.list()).toHaveLength(2);
    });

    it("genuinely different facts are unaffected", () => {
      memory.add("Likes tea");
      const other = memory.addWithStatus("Likes team retrospectives on Fridays");
      expect(other.added).toBe(true);
      expect(memory.list()).toHaveLength(2);
    });

    it("dedup survives reload from disk", () => {
      memory.add("The user ships on Fridays");
      const reloaded = new GlobalMemory(tmpDir);
      expect(reloaded.addWithStatus("The user ships on Fridays.").added).toBe(false);
      expect(reloaded.list()).toHaveLength(1);
    });
  });

  it("list() returns all facts", () => {
    memory.add("fact1");
    memory.add("fact2", "project:p1");
    expect(memory.list()).toHaveLength(2);
  });

  it("list('global') returns only global-scoped facts", () => {
    memory.add("global-fact");
    memory.add("project-fact", "project:p1");
    const globalFacts = memory.list("global");
    expect(globalFacts).toHaveLength(1);
    expect(globalFacts[0]!.text).toBe("global-fact");
  });

  it("remove(id) returns true and removes the fact", () => {
    const fact = memory.add("fact1");
    expect(memory.remove(fact.id)).toBe(true);
    expect(memory.list()).toHaveLength(0);
  });

  it("remove(999) returns false when id does not exist", () => {
    expect(memory.remove(999)).toBe(false);
  });

  it("removeScopes() removes every fact in the given scopes and persists", () => {
    memory.add("keep global", "global");
    memory.add("keep project", "project:p1");
    memory.add("chat memory", "chat:c1");
    memory.add("branch memory", "branch:b1");
    memory.add("other chat", "chat:c2");

    expect(memory.removeScopes(["chat:c1", "branch:b1"])).toBe(2);
    const texts = memory.list().map(f => f.text);
    expect(texts).toEqual(["keep global", "keep project", "other chat"]);
    // Persisted — a fresh instance sees the same three facts.
    expect(new GlobalMemory(tmpDir).list()).toHaveLength(3);
  });

  it("removeScopes() with no matches removes nothing and returns 0", () => {
    memory.add("keep", "global");
    expect(memory.removeScopes(["chat:none"])).toBe(0);
    expect(memory.list()).toHaveLength(1);
  });

  it("forBranch() returns global + matching project/chat/branch scoped facts", () => {
    memory.add("global", "global");
    memory.add("project p1", "project:p1");
    memory.add("chat c1", "chat:c1");
    memory.add("branch b1", "branch:b1");
    memory.add("other project", "project:p2");
    memory.add("other chat", "chat:c2");

    const results = memory.forBranch("b1", "c1", "p1");
    const texts = results.map(f => f.text);
    expect(texts).toContain("global");
    expect(texts).toContain("project p1");
    expect(texts).toContain("chat c1");
    expect(texts).toContain("branch b1");
    expect(texts).not.toContain("other project");
    expect(texts).not.toContain("other chat");
  });

  it("forBranch() without chatId/projectId does not return project/chat facts", () => {
    memory.add("global", "global");
    memory.add("project fact", "project:p1");
    memory.add("chat fact", "chat:c1");
    memory.add("branch fact", "branch:b1");

    const results = memory.forBranch("b1");
    const texts = results.map(f => f.text);
    expect(texts).toContain("global");
    expect(texts).toContain("branch fact");
    expect(texts).not.toContain("project fact");
    expect(texts).not.toContain("chat fact");
  });

  it("asContextBlock() returns null when empty", () => {
    expect(memory.asContextBlock()).toBeNull();
  });

  it("asContextBlock() with facts returns string containing 'Global memories'", () => {
    memory.add("remember this");
    const block = memory.asContextBlock();
    expect(block).not.toBeNull();
    expect(block).toContain("Global memories");
    expect(block).toContain("remember this");
  });

  it("asContextBlock() with project facts returns project section", () => {
    memory.add("proj fact", "project:p1");
    const block = memory.asContextBlock("b1", "c1", "p1");
    expect(block).toContain("Project memories");
  });

  it("persists facts across instances", () => {
    memory.add("persistent fact");
    const memory2 = new GlobalMemory(tmpDir);
    const facts = memory2.list();
    expect(facts).toHaveLength(1);
    expect(facts[0]!.text).toBe("persistent fact");
  });

  it("ids increment: second fact has id=2", () => {
    const f1 = memory.add("first");
    const f2 = memory.add("second");
    expect(f1.id).toBe(1);
    expect(f2.id).toBe(2);
  });

  it("persisted ids continue incrementing correctly after reload", () => {
    memory.add("first");
    const memory2 = new GlobalMemory(tmpDir);
    const f2 = memory2.add("second");
    expect(f2.id).toBe(2);
  });
});
