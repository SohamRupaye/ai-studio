/**
 * Tool approval gating — the policy half of the inline pause card.
 *
 * Mechanism: a single registry.onBeforeExecute hook (registered in
 * initRuntime) calls maybeRequestApproval before every tool run. Because
 * subagent registries delegate back to the main registry's execute, one hook
 * covers the chat agent AND every delegated agent uniformly. A denial throws
 * ToolVetoError, which the registry converts into an error ToolResult the
 * model sees ("User declined…") — the turn continues, nothing crashes.
 *
 * Policy (user decision, 2026-07-18): MCP tools are gated unless their raw
 * name starts with a read verb (fail-safe: unknown shape ⇒ gated). Native
 * tools are not gated here — bash's warn-pattern path is wired separately
 * through setBashConfirmCallback into the same requestApproval flow.
 */
import { randomUUID } from "node:crypto";
import { getMCPManager } from "@squirl/tools-runtime";
import { toolCallSalient, humanizeToolAction, humanizeServerName } from "@squirl/shared";
import { mainWindow, permissions, activeBranchId } from "./state.js";

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

// Read-only MCP verbs: matched against the tool's RAW (un-namespaced) name.
// Boundary accepts _, -, camelCase or end-of-string ("search", "get_page",
// "getPage"). Anything that doesn't match is treated as a write and gated.
const READ_VERBS = /^(get|list|search|read|query|fetch|find|retrieve|describe|lookup|view|count|check)([_\-A-Z.]|$)/;

interface PendingApproval {
  toolName: string;
  branchId: string;
  resolve: (allowed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingApproval>();

// The branch of the turn currently executing — set by chat:send so approval
// cards raised by subagents (whose ToolContext sessionId is "sub") land on
// the right page. Background delegate jobs that outlive the turn fall back
// to the active branch.
let turnBranchId: string | null = null;
export function setApprovalTurnBranch(branchId: string | null) {
  turnBranchId = branchId;
}

/** namespacedName → {server, raw MCP tool name}, or null if not an MCP tool.
 * Scanned live because servers connect/disconnect at runtime. */
function mcpToolInfo(toolId: string): { server: string; raw: string } | null {
  for (const t of getMCPManager().getAllTools()) {
    if (t.namespacedName === toolId) return { server: t.server, raw: t.name };
  }
  return null;
}

/** Does this tool call need user approval (before any always-allow rules)? */
export function needsApproval(toolId: string): boolean {
  const info = mcpToolInfo(toolId);
  if (info === null) return false;
  return !READ_VERBS.test(info.raw);
}

/** The card's one human sentence: "Allow Notion to create pages?" — the
 * trust decision in prose, never the namespaced id + JSON it used to be. */
function approvalTitle(toolId: string): string {
  const info = mcpToolInfo(toolId);
  if (info) return `Allow ${humanizeServerName(info.server)} to ${humanizeToolAction(info.raw, info.server)}?`;
  if (toolId === "bash") return "Run this command?";
  return `Allow ${humanizeToolAction(toolId)}?`;
}

/**
 * Ask the user to approve a tool call. Resolves true/false; consults the
 * PermissionStore first (an "always allow" rule skips the card), times out
 * to deny after 5 minutes. With no window to ask, denies.
 */
export async function requestApproval(input: { name: string; args: unknown; branchId?: string }): Promise<boolean> {
  const ruled = permissions.isAllowed(input.name);
  if (ruled !== null) return ruled;
  if (!mainWindow) return false;

  const branchId = input.branchId ?? turnBranchId ?? activeBranchId;
  const id = randomUUID();
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finishApproval(id, { allowed: false }), APPROVAL_TIMEOUT_MS);
    pending.set(id, { toolName: input.name, branchId, resolve, timer });
    mainWindow?.webContents.send("chat:stream", {
      type: "approval_request",
      branchId,
      id,
      title: approvalTitle(input.name),
      detail: toolCallSalient(input.name, (input.args ?? {}) as Record<string, unknown>),
    });
  });
}

/** Resolve a pending request (renderer decision, timeout, or abort). */
export function finishApproval(id: string, decision: { allowed: boolean; always?: boolean }) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (decision.always && decision.allowed) {
    permissions.save(entry.toolName, "allow");
  }
  // Clears the card on every resolution path the renderer didn't initiate
  // (timeout, turn abort) — harmless echo when it did.
  mainWindow?.webContents.send("chat:stream", { type: "approval_resolved", branchId: entry.branchId, id });
  entry.resolve(decision.allowed);
}

/** Deny everything pending — called when a turn is aborted or superseded. */
export function cancelPendingApprovals() {
  for (const id of [...pending.keys()]) finishApproval(id, { allowed: false });
}
