import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type MemoryScope = "global" | `project:${string}` | `chat:${string}` | `branch:${string}`;

export interface MemoryFact {
  id: number;
  text: string;
  scope: MemoryScope;
  createdAt: number;
}

function normalizeFact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.!?…]+$/g, "").trim();
}

function factTokens(text: string): Set<string> {
  return new Set(normalizeFact(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
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

  /** add(), plus whether a new fact was actually inserted — lets the
   * remember tool answer "Already remembered" honestly. */
  addWithStatus(text: string, scope: MemoryScope = "global"): { fact: MemoryFact; added: boolean } {
    const existing = this.findDuplicate(text, scope);
    if (existing) return { fact: existing, added: false };
    const fact: MemoryFact = { id: this.nextId++, text, scope, createdAt: Date.now() };
    this.facts.push(fact);
    this.save();
    return { fact, added: true };
  }

  /** Same-scope duplicate: normalized-exact match, or token-set Jaccard
   * ≥ 0.85 (near-identical phrasing). Deterministic only — no embeddings. */
  private findDuplicate(text: string, scope: MemoryScope): MemoryFact | undefined {
    const norm = normalizeFact(text);
    const toks = factTokens(text);
    for (const f of this.facts) {
      if (f.scope !== scope) continue;
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

  list(scope?: MemoryScope): MemoryFact[] {
    if (!scope) return this.facts;
    return this.facts.filter(f => f.scope === scope);
  }

  /**
   * Get all facts visible to a branch, ordered by specificity:
   * global → project → chat → branch
   */
  forBranch(branchId: string, chatId?: string, projectId?: string): MemoryFact[] {
    return this.facts.filter(f =>
      f.scope === "global" ||
      (projectId && f.scope === `project:${projectId}`) ||
      (chatId && f.scope === `chat:${chatId}`) ||
      f.scope === `branch:${branchId}`
    );
  }

  /** Produce a context block with layered memories for a branch. */
  asContextBlock(branchId?: string, chatId?: string, projectId?: string): string | null {
    const facts = branchId
      ? this.forBranch(branchId, chatId, projectId)
      : this.facts;
    if (!facts.length) return null;

    const lines: string[] = [];
    const global = facts.filter(f => f.scope === "global");
    const project = facts.filter(f => f.scope.startsWith("project:"));
    const chat = facts.filter(f => f.scope.startsWith("chat:"));
    const branch = facts.filter(f => f.scope.startsWith("branch:"));

    if (global.length) {
      lines.push("[Global memories]");
      for (const f of global) lines.push(`• ${f.text}`);
    }
    if (project.length) {
      lines.push("[Project memories]");
      for (const f of project) lines.push(`• ${f.text}`);
    }
    if (chat.length) {
      lines.push("[Chat memories]");
      for (const f of chat) lines.push(`• ${f.text}`);
    }
    if (branch.length) {
      lines.push("[Branch memories]");
      for (const f of branch) lines.push(`• ${f.text}`);
    }

    return lines.join("\n");
  }
}
