import type { ContextStats } from "@squirl/event-bus";
import { handle } from "./handle.js";
import { store, globalMem } from "../state.js";

export function registerMemoryHandlers() {
  // ── Memory ──────────────────────────────────────────────────────────────────

  handle("memory:list", ({ scope }) => globalMem.list(scope as any));
  handle("memory:add", ({ text, scope }) => globalMem.add(text, scope as any));
  handle("memory:remove", ({ id }) => globalMem.remove(id));
  // The exact fact set prompt assembly resolves for this branch — the right
  // panel shows memories the way the model receives them.
  handle("memory:for-branch", ({ branchId }) => {
    const branch = store.getBranch(branchId);
    if (!branch) return [];
    const chat = branch.chatId ? store.getChat(branch.chatId) : undefined;
    return globalMem.forBranch(branchId, branch.chatId, chat?.projectId);
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
