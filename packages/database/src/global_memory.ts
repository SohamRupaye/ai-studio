import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type MemoryScope = "global" | `project:${string}` | `chat:${string}` | `branch:${string}`;

export interface MemoryFact {
  id: number;
  text: string;
  scope: MemoryScope;
  createdAt: number;
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

  add(text: string, scope: MemoryScope = "global"): MemoryFact {
    const fact: MemoryFact = { id: this.nextId++, text, scope, createdAt: Date.now() };
    this.facts.push(fact);
    this.save();
    return fact;
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
