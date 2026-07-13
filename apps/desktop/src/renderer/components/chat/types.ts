import type { SubagentRunRecord } from "@ai-studio/shared";

/** One delegated agent inside a subagent/delegate call — built live from
 * `subagent` stream events (via the same shared reducer main persists with),
 * or read back from the persisted message's tool_calls. runId/startedAt are
 * only present on live runs. */
export type SubagentRun = SubagentRunRecord & { runId?: string; startedAt?: number };

export type ToolCallState = {
  name: string;
  status: "running" | "done" | "error";
  /** Human-salient one-liner (the bash command, the URL, the query) — the
   * row answers "what did that call actually do". Live rows compute it with
   * the same shared toolCallSummary main persists with; rows persisted
   * before summaries existed fall back to the stored argsPreview. */
  summary?: string;
  /** Full (capped) args/result for the expandable detail panel. */
  args?: string;
  result?: string;
  agents?: SubagentRun[];
};
