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

  describe("supersession (isLatest / git-for-facts)", () => {
    it("supersede hides the old fact from the working set but keeps it as history", () => {
      const old = memory.add("Alex works at Google");
      const fresh = memory.add("Alex works at Stripe");
      expect(memory.supersede(old.id, fresh.id)).toBe(true);

      const active = memory.list();
      expect(active.map(f => f.text)).toEqual(["Alex works at Stripe"]);
      // Still on disk as history, linked to its replacement.
      const all = memory.list(undefined, { includeSuperseded: true });
      expect(all).toHaveLength(2);
      const superseded = all.find(f => f.id === old.id)!;
      expect(superseded.status).toBe("superseded");
      expect(superseded.supersededById).toBe(fresh.id);
    });

    it("asContextBlock (what the model sees) excludes superseded facts and carries #id handles", () => {
      const old = memory.add("Ships on Mondays");
      const fresh = memory.add("Ships on Fridays");
      memory.supersede(old.id, fresh.id);
      const block = memory.asContextBlock()!;
      expect(block).toContain(`(#${fresh.id}) Ships on Fridays`);
      expect(block).not.toContain("Mondays");
    });

    it("forBranch excludes superseded by default, includes them with the opt", () => {
      const old = memory.add("v1", "project:p1");
      const fresh = memory.add("v2", "project:p1");
      memory.supersede(old.id, fresh.id, "branch:b1");
      expect(memory.forBranch("b1", undefined, "p1").map(f => f.text)).toEqual(["v2"]);
      expect(memory.forBranch("b1", undefined, "p1", { includeSuperseded: true })).toHaveLength(2);
    });

    it("restore brings a superseded fact back into the working set", () => {
      const old = memory.add("keep me");
      const fresh = memory.add("replacement");
      memory.supersede(old.id, fresh.id);
      expect(memory.list()).toHaveLength(1);
      expect(memory.restore(old.id)).toBe(true);
      expect(memory.list()).toHaveLength(2);
      expect(memory.list().find(f => f.id === old.id)!.status).toBe("active");
    });

    it("supersede is a no-op for unknown ids or self", () => {
      const a = memory.add("a");
      expect(memory.supersede(a.id, 999)).toBe(false);
      expect(memory.supersede(999, a.id)).toBe(false);
      expect(memory.supersede(a.id, a.id)).toBe(false);
    });

    it("a superseded fact doesn't block re-adding the same text (it came back)", () => {
      const old = memory.add("recurring fact");
      const fresh = memory.add("something else");
      memory.supersede(old.id, fresh.id);
      const readd = memory.addWithStatus("recurring fact");
      expect(readd.added).toBe(true);
    });

    it("supersession survives reload from disk", () => {
      const old = memory.add("stale");
      const fresh = memory.add("current");
      memory.supersede(old.id, fresh.id, "branch:b1");
      const reloaded = new GlobalMemory(tmpDir);
      expect(reloaded.list().map(f => f.text)).toEqual(["current"]);
      expect(reloaded.list(undefined, { includeSuperseded: true })).toHaveLength(2);
    });
  });

  describe("memory types + lifecycle", () => {
    it("a preference strengthens on restatement instead of being a no-op dup", () => {
      const p = memory.addWithStatus("Prefers dark mode", "global", undefined, { type: "preference" });
      expect(p.fact.reinforceCount).toBe(1);
      const again = memory.addWithStatus("prefers dark mode", "global", undefined, { type: "preference" });
      expect(again.added).toBe(false);
      expect(again.fact.id).toBe(p.fact.id);
      expect(again.fact.reinforceCount).toBe(2);
      expect(memory.list()).toHaveLength(1);
    });

    it("an episode expires past expiresAt and leaves the working set (kept as history)", () => {
      const past = memory.addWithStatus("Meeting at 3pm today", "global", undefined, { type: "episode", expiresAt: 1000 });
      const future = memory.addWithStatus("Dentist next month", "global", undefined, { type: "episode", expiresAt: 9_000_000_000_000 });
      const swept = memory.sweepExpired(2000);
      expect(swept).toBe(1);
      const active = memory.list();
      expect(active.map(f => f.text)).toEqual(["Dentist next month"]);
      expect(memory.list(undefined, { includeSuperseded: true })).toHaveLength(2);
      expect(memory.list(undefined, { includeSuperseded: true }).find(f => f.id === past.fact.id)!.status).toBe("expired");
      expect(future.fact.status).toBe("active");
    });

    it("expired facts are excluded from asContextBlock (the model view)", () => {
      memory.addWithStatus("Standup at 9 today", "global", undefined, { type: "episode", expiresAt: 1000 });
      memory.add("Persistent fact");
      memory.sweepExpired(2000);
      const block = memory.asContextBlock()!;
      expect(block).toContain("Persistent fact");
      expect(block).not.toContain("Standup");
    });

    it("restore brings an expired episode back into the working set", () => {
      const e = memory.addWithStatus("Recurring event", "global", undefined, { type: "episode", expiresAt: 1000 });
      memory.sweepExpired(2000);
      expect(memory.list()).toHaveLength(0);
      expect(memory.restore(e.fact.id)).toBe(true);
      expect(memory.list()).toHaveLength(1);
    });

    it("types + lifecycle survive reload", () => {
      memory.addWithStatus("Prefers tabs over spaces", "global", undefined, { type: "preference" });
      memory.addWithStatus("Prefers tabs over spaces", "global", undefined, { type: "preference" });
      const reloaded = new GlobalMemory(tmpDir);
      const pref = reloaded.list().find(f => f.type === "preference")!;
      expect(pref.reinforceCount).toBe(2);
    });
  });

  describe("typed edges + candidate shortlist (phase 3 substrate)", () => {
    it("addEdge links two facts; supersede also records an updates edge", () => {
      const a = memory.add("Alex works at Google");
      const b = memory.add("Alex leads a team of 5");
      expect(memory.addEdge(b.id, a.id, "extends")).toBe(true);
      expect(memory.list().find(f => f.id === b.id)!.edges).toEqual([{ to: a.id, type: "extends" }]);
      // dedup: same edge twice is a no-op
      expect(memory.addEdge(b.id, a.id, "extends")).toBe(false);

      const c = memory.add("Alex works at Stripe");
      memory.supersede(a.id, c.id);
      expect(memory.list(undefined, { includeSuperseded: true }).find(f => f.id === c.id)!.edges)
        .toEqual([{ to: a.id, type: "updates" }]);
    });

    it("addEdge is a no-op for missing facts or self-edges", () => {
      const a = memory.add("solo");
      expect(memory.addEdge(a.id, a.id, "relates")).toBe(false);
      expect(memory.addEdge(a.id, 999, "relates")).toBe(false);
    });

    it("relatedCandidates ranks active same-scope facts by token overlap, excludes self", () => {
      const base = memory.add("Alex works on payments infrastructure at Stripe");
      memory.add("Alex works on payments and fraud at Stripe"); // high overlap
      memory.add("The weather is nice today");                  // no overlap
      const cands = memory.relatedCandidates(base.id, 5);
      expect(cands.length).toBe(1);
      expect(cands[0]!.fact.text).toContain("fraud");
      expect(cands[0]!.score).toBeGreaterThan(0);
    });

    it("candidatePool returns active same-scope facts (excl self), capped", () => {
      const base = memory.add("base fact", "project:p1");
      memory.add("sibling one", "project:p1");
      memory.add("sibling two", "project:p1");
      memory.add("other scope", "project:p2");
      const old = memory.add("stale", "project:p1");
      memory.supersede(old.id, base.id);
      const pool = memory.candidatePool(base.id);
      expect(pool.map(f => f.text).sort()).toEqual(["sibling one", "sibling two"]);
      expect(memory.candidatePool(base.id, 1)).toHaveLength(1);
    });

    it("relatedCandidates ignores superseded/expired and other scopes", () => {
      const base = memory.add("shipping cadence weekly", "project:p1");
      const old = memory.add("shipping cadence daily", "project:p1");
      memory.supersede(old.id, base.id);
      memory.add("shipping cadence monthly", "project:p2"); // different scope
      expect(memory.relatedCandidates(base.id, 5)).toHaveLength(0);
    });
  });

  it("asContextBlock nests extends-children under the fact they enrich", () => {
    const role = memory.add("Alex works at Stripe as a PM");
    const detail = memory.add("Alex focuses on payments infrastructure and leads a team of 5");
    memory.addEdge(detail.id, role.id, "extends");
    const block = memory.asContextBlock()!;
    const lines = block.split("\n");
    // The enriching fact renders indented under its parent, not as a sibling bullet.
    const roleLine = lines.findIndex(l => l.includes("as a PM"));
    const detailLine = lines.findIndex(l => l.includes("payments infrastructure"));
    expect(roleLine).toBeGreaterThanOrEqual(0);
    expect(detailLine).toBe(roleLine + 1);
    expect(lines[detailLine]).toContain("↳");
    // The child is not ALSO listed at top level.
    expect(lines.filter(l => l.includes("payments infrastructure"))).toHaveLength(1);
  });

  describe("branch-aware isLatest (the git-for-facts moat)", () => {
    it("a supersession on one fork does NOT hide the fact for a sibling fork", () => {
      // A project fact both branches can see; superseded on branch "b1".
      const old = memory.add("Deploys on Fridays", "project:p1");
      const fresh = memory.add("Deploys on Tuesdays", "project:p1");
      memory.supersede(old.id, fresh.id, "b1");

      // b1 (and descendants) see the update: only the fresh fact.
      const onB1 = memory.forBranch("b1", undefined, "p1", { ancestry: new Set(["b1"]) });
      expect(onB1.map(f => f.text)).toContain("Deploys on Tuesdays");
      expect(onB1.map(f => f.text)).not.toContain("Deploys on Fridays");

      // b2, a sibling that never saw the update, still has the old fact current.
      const onB2 = memory.forBranch("b2", undefined, "p1", { ancestry: new Set(["b2"]) });
      expect(onB2.map(f => f.text)).toContain("Deploys on Fridays");
    });

    it("a descendant branch inherits its ancestor's supersession", () => {
      const old = memory.add("v1", "project:p1");
      const fresh = memory.add("v2", "project:p1");
      memory.supersede(old.id, fresh.id, "parent");
      // child forked from parent → ancestry includes parent → sees the update.
      const onChild = memory.forBranch("child", undefined, "p1", { ancestry: new Set(["child", "parent"]) });
      expect(onChild.map(f => f.text)).toEqual(["v2"]);
    });

    it("with no ancestry given, supersession hides globally (backward compatible)", () => {
      const old = memory.add("old", "project:p1");
      const fresh = memory.add("new", "project:p1");
      memory.supersede(old.id, fresh.id, "b1");
      expect(memory.forBranch("whatever", undefined, "p1").map(f => f.text)).toEqual(["new"]);
    });

    it("branchStatus reports a fact superseded on a sibling as active here (panel accuracy)", () => {
      const old = memory.add("old", "project:p1");
      const fresh = memory.add("new", "project:p1");
      memory.supersede(old.id, fresh.id, "b1");
      const oldFact = memory.list(undefined, { includeSuperseded: true }).find(f => f.id === old.id)!;
      // On b1 (in ancestry) it's superseded; on sibling b2 it's still active.
      expect(memory.branchStatus(oldFact, new Set(["b1"]))).toBe("superseded");
      expect(memory.branchStatus(oldFact, new Set(["b2"]))).toBe("active");
    });
  });

  describe("derived facts (phase 6, gated + quarantined)", () => {
    it("addDerived creates an [inferred]-labeled fact linked to its sources", () => {
      const a = memory.add("Alex is a PM at Stripe");
      const b = memory.add("Alex frequently discusses payment APIs");
      const d = memory.addDerived("Alex likely works on Stripe's core payments product", "global", [a.id, b.id]);
      expect(d.type).toBe("derived");
      expect(d.edges).toEqual([{ to: a.id, type: "derives" }, { to: b.id, type: "derives" }]);
      const block = memory.asContextBlock()!;
      expect(block).toContain("[inferred] Alex likely works on Stripe's core payments product");
    });

    it("a derived fact is active but stated facts still render without a label", () => {
      memory.add("Stated fact");
      memory.addDerived("Inferred thing", "global", []);
      const block = memory.asContextBlock()!;
      expect(block).toContain("• (#1) Stated fact");
      expect(block).toContain("[inferred] Inferred thing");
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
