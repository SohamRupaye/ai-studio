import type { ContextStats } from "@squirl/event-bus";
import { handle } from "./handle.js";
import { store, globalMem } from "../state.js";

export function registerMemoryHandlers() {
  // ── Memory ──────────────────────────────────────────────────────────────────

  handle("memory:list", ({ scope }) => globalMem.list(scope as any));
  handle("memory:add", ({ text, scope }) => globalMem.add(text, scope as any));
  handle("memory:remove", ({ id }) => globalMem.remove(id));
  handle("memory:restore", ({ id }) => globalMem.restore(id));
  // The exact fact set prompt assembly resolves for this branch — the right
  // panel shows memories the way the model receives them. includeSuperseded
  // adds the history (superseded facts) so the panel can show what changed.
  handle("memory:for-branch", ({ branchId, includeSuperseded }) => {
    const branch = store.getBranch(branchId);
    if (!branch) return [];
    const chat = branch.chatId ? store.getChat(branch.chatId) : undefined;
    // Branch ancestry (this branch + all parents) so supersession status is
    // reported relative to THIS branch: a fact superseded on a sibling fork
    // reads active here, matching what the model actually sees.
    const ancestry = new Set<string>();
    for (let b: typeof branch | undefined = branch; b; b = b.parentId ? store.getBranch(b.parentId) : undefined) {
      if (ancestry.has(b.id)) break;
      ancestry.add(b.id);
    }
    return globalMem
      .forBranch(branchId, branch.chatId, chat?.projectId, { includeSuperseded, ancestry })
      .map((f) => ({ ...f, status: globalMem.branchStatus(f, ancestry) }));
  });

  // ── Context inspector (right panel) ─────────────────────────────────────────

  handle("context:stats", ({ branchId }) => {
    const raw = store.getMeta(`ctxstats:${branchId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ContextStats;
      // Stats persisted before artifact selection existed lack the field.
      return { ...parsed, artifactTokens: parsed.artifactTokens ?? 0 };
    } catch { return null; }
  });
}
