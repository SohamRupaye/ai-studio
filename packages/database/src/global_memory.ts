import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type MemoryScope = "global" | `project:${string}` | `chat:${string}` | `branch:${string}`;

/**
 * How a fact behaves over time (see context/memory-graph-redesign.md):
 * - fact: persists until superseded.
 * - preference: strengthens with repetition (reinforceCount) instead of duping.
 * - episode: time-bound; expires past expiresAt, dropping out of the working set.
 */
export type MemoryType = "fact" | "preference" | "episode" | "derived";

/** Lifecycle state. Only "active" facts are in the working set (what the model
 * sees). The rest are history — never deleted, always restorable/queryable. */
export type MemoryStatus = "active" | "superseded" | "expired" | "archived";

export type MemoryEdgeType = "updates" | "extends" | "relates" | "derives";

export interface MemoryEdge {
  /** Related fact id. */
  to: number;
  type: MemoryEdgeType;
  /** Similarity/confidence for relates edges (0..1); omitted for updates/extends. */
  weight?: number;
}

export interface MemoryFact {
  id: number;
  text: string;
  scope: MemoryScope;
  createdAt: number;
  type?: MemoryType;
  /** Living-memory lifecycle (see context/memory-graph-redesign.md). A fact is
   * never deleted when it changes — it's marked "superseded"/"expired" and
   * drops out of the working set (the isLatest view), still queryable as
   * history. Legacy facts with no status load as "active". */
  status?: MemoryStatus;
  /** The fact that replaced this one (set when status = "superseded"). */
  supersededById?: number;
  supersededAt?: number;
  /** Branch that recorded the supersession — data for branch-scoped isLatest. */
  supersededOnBranch?: string;
  /** Branch that created the fact (git-for-facts provenance). */
  originBranch?: string;
  /** Preference reinforcement: how many times it's been restated. */
  reinforceCount?: number;
  lastSeenAt?: number;
  /** Episodes: when this fact stops being relevant (epoch ms). */
  expiresAt?: number;
  /** Typed relationships to other facts ("facts built on facts"). */
  edges?: MemoryEdge[];
}

function normalizeFact(text: string): string {
  const collapsed = text.toLowerCase().replace(/\s+/g, " ");
  let end = collapsed.length;
  while (end > 0 && ".!?…".includes(collapsed[end - 1]!)) end--;
  return collapsed.slice(0, end).trim();
}

function factTokens(text: string): Set<string> {
  return new Set(normalizeFact(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** In the working set = what the model sees. Everything else is history. */
function isActive(f: MemoryFact): boolean {
  return f.status === undefined || f.status === "active";
}

/**
 * Branch-aware working-set membership — the git-for-facts moat. A supersession
 * only applies to branches that can "see" it: the branch it happened on and
 * its descendants (identified by the querying branch's `ancestry` set — its own
 * id plus all parents). A fact superseded on a *sibling* fork is still current
 * for this branch, so it stays visible.
 *
 * With no ancestry (callers that don't compute it), a superseded fact is hidden
 * globally (phase-1 behavior) — safe and backward compatible. Expired/archived
 * facts are time/manual, not branch-relative, so always out.
 */
function inWorkingSet(f: MemoryFact, ancestry?: Set<string>): boolean {
  if (isActive(f)) return true;
  if (f.status !== "superseded") return false;
  if (!ancestry || f.supersededOnBranch === undefined) return false;
  return !ancestry.has(f.supersededOnBranch);
}

export class GlobalMemory {
  private facts: MemoryFact[] = [];
  private filePath: string;
  private nextId = 1;

  constructor(dataDir?: string) {
    const dir = dataDir ?? join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "global_memory.json");
    this.load();
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
      this.facts = (data.facts || []).map((f: any) => ({
        ...f,
        scope: f.scope || "global",
        status: f.status || "active",
      }));
      this.nextId = this.facts.length ? Math.max(...this.facts.map(f => f.id)) + 1 : 1;
    } catch { /* fresh */ }
  }

  private save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ facts: this.facts }, null, 2));
  }

  /** Add a fact, deduplicating within its scope: an (effectively) identical
   * fact returns the existing entry instead of inserting a copy. Both the
   * remember tool and chat's deterministic auto-capture funnel through here,
   * so "remember X" twice can't double the memory panel. */
  add(text: string, scope: MemoryScope = "global"): MemoryFact {
    return this.addWithStatus(text, scope).fact;
  }

  /**
   * add(), plus whether a new fact was actually inserted. A same-scope
   * duplicate returns the existing fact (added:false) — and if it's a
   * preference, restating it *reinforces* it (bumps reinforceCount/lastSeenAt)
   * rather than being a no-op, so preferences strengthen with repetition.
   */
  addWithStatus(
    text: string,
    scope: MemoryScope = "global",
    originBranch?: string,
    opts?: { type?: MemoryType; expiresAt?: number },
  ): { fact: MemoryFact; added: boolean } {
    const existing = this.findDuplicate(text, scope);
    if (existing) {
      if ((opts?.type ?? existing.type) === "preference") {
        existing.type = "preference";
        existing.reinforceCount = (existing.reinforceCount ?? 1) + 1;
        existing.lastSeenAt = Date.now();
        this.save();
      }
      return { fact: existing, added: false };
    }
    const type = opts?.type ?? "fact";
    const fact: MemoryFact = {
      id: this.nextId++, text, scope, createdAt: Date.now(), status: "active", originBranch, type,
      ...(type === "preference" ? { reinforceCount: 1, lastSeenAt: Date.now() } : {}),
      ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    };
    this.facts.push(fact);
    this.save();
    return { fact, added: true };
  }

  /**
   * Expire episodes whose expiresAt has passed (called on startup + on a timer).
   * "Forgetting" is soft — expired facts leave the working set but stay as
   * history. Returns the count expired. `now` is injectable for tests.
   */
  sweepExpired(now = Date.now()): number {
    let expired = 0;
    for (const f of this.facts) {
      if (isActive(f) && f.expiresAt !== undefined && f.expiresAt <= now) {
        f.status = "expired";
        expired++;
      }
    }
    if (expired) this.save();
    return expired;
  }

  /**
   * Mark `oldId` superseded by `newId` (git-for-facts: the old fact isn't
   * deleted — it drops out of the isLatest working set but stays as history).
   * No-op unless both exist and differ. `onBranch` records where the
   * supersession happened (data for phase-5 branch-scoped resolution; phase 1
   * hides superseded facts globally). Returns whether it applied.
   */
  supersede(oldId: number, newId: number, onBranch?: string): boolean {
    if (oldId === newId) return false;
    const oldFact = this.facts.find(f => f.id === oldId);
    const newFact = this.facts.find(f => f.id === newId);
    if (!oldFact || !newFact) return false;
    oldFact.status = "superseded";
    oldFact.supersededById = newId;
    oldFact.supersededAt = Date.now();
    oldFact.supersededOnBranch = onBranch;
    // Record the relationship on the graph too ("facts built on facts").
    this.linkEdge(newFact, { to: oldId, type: "updates" });
    this.save();
    return true;
  }

  /**
   * Add an INFERRED fact (phase 6 "derives"). Deliberately quarantined: it's
   * typed "derived", linked to the source facts it was inferred from, and — the
   * safety rule from the design doc — it can never supersede a stated fact and
   * renders labeled "[inferred]" so the model discounts it. Off by default;
   * only the gated detector calls this.
   */
  addDerived(text: string, scope: MemoryScope, sourceIds: number[], originBranch?: string): MemoryFact {
    const fact: MemoryFact = {
      id: this.nextId++, text, scope, createdAt: Date.now(), status: "active",
      type: "derived", originBranch,
      edges: sourceIds.filter(id => this.facts.some(f => f.id === id)).map(id => ({ to: id, type: "derives" as const })),
    };
    this.facts.push(fact);
    this.save();
    return fact;
  }

  /** Add a typed relationship from `fromId` to `toId` (deduped by to+type).
   * updates/extends carry epistemic meaning; relates is the similarity
   * substrate. No-op if either fact is missing or it's a self-edge. */
  addEdge(fromId: number, toId: number, type: MemoryEdgeType, weight?: number): boolean {
    if (fromId === toId) return false;
    const from = this.facts.find(f => f.id === fromId);
    if (!from || !this.facts.some(f => f.id === toId)) return false;
    if (this.linkEdge(from, { to: toId, type, weight })) { this.save(); return true; }
    return false;
  }

  private linkEdge(from: MemoryFact, edge: MemoryEdge): boolean {
    from.edges ??= [];
    if (from.edges.some(e => e.to === edge.to && e.type === edge.type)) return false;
    from.edges.push(edge);
    return true;
  }

  /** Active same-scope facts other than `id`, capped — the raw pool the
   * detector ranks with embeddings (semantic shortlist). Kept separate from
   * relatedCandidates so the embedding path in main can score the pool itself
   * without this package depending on the embedder. */
  candidatePool(id: number, limit = 50): MemoryFact[] {
    const self = this.facts.find(f => f.id === id);
    if (!self) return [];
    const pool: MemoryFact[] = [];
    for (const f of this.facts) {
      if (f.id === id || f.scope !== self.scope || !isActive(f)) continue;
      pool.push(f);
      if (pool.length >= limit) break;
    }
    return pool;
  }

  /** Active same-scope facts sharing vocabulary with fact `id`, scored by
   * token-set Jaccard and ranked — the deterministic fallback shortlist when no
   * embedder is available. Excludes `id` itself. */
  relatedCandidates(id: number, limit = 5): Array<{ fact: MemoryFact; score: number }> {
    const self = this.facts.find(f => f.id === id);
    if (!self) return [];
    const toks = factTokens(self.text);
    const scored: Array<{ fact: MemoryFact; score: number }> = [];
    for (const f of this.facts) {
      if (f.id === id || f.scope !== self.scope || !isActive(f)) continue;
      const fToks = factTokens(f.text);
      let inter = 0;
      for (const t of toks) if (fToks.has(t)) inter++;
      const union = toks.size + fToks.size - inter;
      const score = union > 0 ? inter / union : 0;
      if (score > 0) scored.push({ fact: f, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * A fact's effective status *for a branch* (given its ancestry set). A fact
   * superseded on a sibling fork — one not in this branch's ancestry — reads
   * "active" here, because that supersession doesn't apply to this branch.
   * Lets a UI show a branch-accurate active/history split, not the global one.
   */
  branchStatus(fact: MemoryFact, ancestry?: Set<string>): MemoryStatus {
    if (
      fact.status === "superseded" &&
      ancestry &&
      fact.supersededOnBranch !== undefined &&
      !ancestry.has(fact.supersededOnBranch)
    ) {
      return "active";
    }
    return fact.status ?? "active";
  }

  /** Undo a supersession/expiry/archive — bring a fact back into the working
   * set. (An expired episode brought back keeps its old expiresAt, so it
   * re-expires next sweep unless the caller also clears it — that's fine.) */
  restore(id: number): boolean {
    const fact = this.facts.find(f => f.id === id);
    if (!fact || isActive(fact)) return false;
    fact.status = "active";
    delete fact.supersededById;
    delete fact.supersededAt;
    delete fact.supersededOnBranch;
    this.save();
    return true;
  }

  /** Same-scope duplicate among ACTIVE facts: normalized-exact match, or
   * token-set Jaccard ≥ 0.85 (near-identical phrasing). Deterministic only —
   * no embeddings. Superseded facts don't block re-adding (the fact came back).*/
  private findDuplicate(text: string, scope: MemoryScope): MemoryFact | undefined {
    const norm = normalizeFact(text);
    const toks = factTokens(text);
    for (const f of this.facts) {
      if (f.scope !== scope || !isActive(f)) continue;
      if (normalizeFact(f.text) === norm) return f;
      const fToks = factTokens(f.text);
      let inter = 0;
      for (const t of toks) if (fToks.has(t)) inter++;
      const union = toks.size + fToks.size - inter;
      if (union > 0 && inter / union >= 0.85) return f;
    }
    return undefined;
  }

  remove(id: number): boolean {
    const idx = this.facts.findIndex(f => f.id === id);
    if (idx === -1) return false;
    this.facts.splice(idx, 1);
    this.save();
    return true;
  }

  /** Remove every fact in any of the given scopes (one save). Returns the count removed. */
  removeScopes(scopes: MemoryScope[]): number {
    const doomed = new Set<MemoryScope>(scopes);
    const before = this.facts.length;
    this.facts = this.facts.filter(f => !doomed.has(f.scope));
    const removed = before - this.facts.length;
    if (removed) this.save();
    return removed;
  }

  /** By default only the isLatest working set (active facts); pass
   * includeSuperseded to also get history (superseded/expired/archived). */
  list(scope?: MemoryScope, opts?: { includeSuperseded?: boolean }): MemoryFact[] {
    const base = opts?.includeSuperseded ? this.facts : this.facts.filter(isActive);
    if (!scope) return base;
    return base.filter(f => f.scope === scope);
  }

  /**
   * Get all facts visible to a branch, ordered by specificity:
   * global → project → chat → branch. Active-only by default (what prompt
   * assembly gets — history must never reach the model); includeSuperseded
   * gives the UI the full history for a branch.
   */
  forBranch(
    branchId: string,
    chatId?: string,
    projectId?: string,
    opts?: { includeSuperseded?: boolean; ancestry?: Set<string> },
  ): MemoryFact[] {
    return this.facts.filter(f =>
      (opts?.includeSuperseded || inWorkingSet(f, opts?.ancestry)) &&
      (f.scope === "global" ||
        (projectId && f.scope === `project:${projectId}`) ||
        (chatId && f.scope === `chat:${chatId}`) ||
        f.scope === `branch:${branchId}`)
    );
  }

  /** Produce a context block with layered memories for a branch. Active facts
   * only (the isLatest view); each carries a #id handle so the model can name
   * a fact to supersede. Enriching facts (an `extends` edge) render nested
   * under the fact they extend, so the model sees the living structure —
   * "facts built on facts" — not a flat list. */
  asContextBlock(branchId?: string, chatId?: string, projectId?: string, ancestry?: Set<string>): string | null {
    const facts = branchId
      ? this.forBranch(branchId, chatId, projectId, { ancestry })
      : this.facts.filter(isActive);
    if (!facts.length) return null;

    const byId = new Map(facts.map(f => [f.id, f]));
    // A fact is a "child" (rendered nested) when it extends another fact that's
    // also in this set. Everything else is rendered at top level.
    const childrenOf = new Map<number, MemoryFact[]>();
    const isChild = new Set<number>();
    for (const f of facts) {
      const parentId = f.edges?.find(e => e.type === "extends" && byId.has(e.to))?.to;
      if (parentId !== undefined) {
        (childrenOf.get(parentId) ?? childrenOf.set(parentId, []).get(parentId)!).push(f);
        isChild.add(f.id);
      }
    }

    const render = (f: MemoryFact, indent: string, lines: string[]) => {
      // Derived facts are inferences, not stated facts — label them so the
      // model treats them as lower-confidence.
      const prefix = f.type === "derived" ? "[inferred] " : "";
      lines.push(`${indent}• (#${f.id}) ${prefix}${f.text}`);
      for (const child of childrenOf.get(f.id) ?? []) render(child, indent + "  ↳ ", lines);
    };

    const lines: string[] = [];
    const groups: Array<[string, (s: string) => boolean]> = [
      ["[Global memories]", s => s === "global"],
      ["[Project memories]", s => s.startsWith("project:")],
      ["[Chat memories]", s => s.startsWith("chat:")],
      ["[Branch memories]", s => s.startsWith("branch:")],
    ];
    for (const [label, match] of groups) {
      const group = facts.filter(f => match(f.scope) && !isChild.has(f.id));
      if (!group.length) continue;
      lines.push(label);
      for (const f of group) render(f, "", lines);
    }
    return lines.join("\n");
  }
}
