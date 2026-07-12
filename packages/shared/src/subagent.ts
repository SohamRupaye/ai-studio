import type { SubagentRunRecord } from "./models.js";

/** Lifecycle event of one delegated agent, streamed while it runs. Emitted by
 * ai-core's runTask, forwarded to the renderer over chat:stream, and folded
 * into a SubagentRunRecord by applySubagentEvent on BOTH sides — main (for
 * persistence) and renderer (for the live drawer) build the same trail. */
export interface SubagentStreamEvent {
  runId: string;
  agentId: string;
  status: "start" | "text" | "tool" | "tool_end" | "done" | "failed";
  /** "start": the full task text. */
  task?: string;
  /** "start": the model the agent runs on (fallback re-announces it). */
  model?: string;
  /** "text": a text delta the agent wrote. */
  text?: string;
  /** "tool" / "tool_end": tool name. */
  tool?: string;
  /** "tool": compact one-line JSON args preview. */
  args?: string;
  /** "tool_end": whether the call succeeded. */
  success?: boolean;
  /** "tool_end": short preview of the tool's output. */
  resultPreview?: string;
  /** "done": the agent's final text. */
  result?: string;
  /** "failed": the error message. */
  error?: string;
}

// Bounds so a chatty agent can't bloat the persisted message row (the full
// result still travels separately, capped by the caller).
const MAX_STEPS = 300;
const MAX_TEXT_PER_STEP = 12_000;

export function newSubagentRecord(agentId: string): SubagentRunRecord {
  return { agentId, task: "", model: "", status: "running", steps: [] };
}

/** Folds one stream event into a run record. Mutates `rec`. */
export function applySubagentEvent(rec: SubagentRunRecord, ev: SubagentStreamEvent): void {
  switch (ev.status) {
    case "start":
      // May fire twice for one agent — model fallback re-announces the model
      // the agent actually runs on.
      rec.task = ev.task ?? rec.task;
      rec.model = ev.model ?? rec.model;
      rec.status = "running";
      break;
    case "text": {
      if (!ev.text) break;
      const last = rec.steps[rec.steps.length - 1];
      if (last?.type === "text") {
        if ((last.text?.length ?? 0) < MAX_TEXT_PER_STEP) {
          last.text = ((last.text ?? "") + ev.text).slice(0, MAX_TEXT_PER_STEP);
        }
      } else if (rec.steps.length < MAX_STEPS) {
        rec.steps.push({ type: "text", text: ev.text.slice(0, MAX_TEXT_PER_STEP) });
      }
      break;
    }
    case "tool":
      if (rec.steps.length < MAX_STEPS && ev.tool) {
        rec.steps.push({ type: "tool", tool: ev.tool, args: ev.args });
      }
      break;
    case "tool_end": {
      // Close the most recent still-open call of this tool.
      for (let i = rec.steps.length - 1; i >= 0; i--) {
        const step = rec.steps[i]!;
        if (step.type === "tool" && step.tool === ev.tool && step.success === undefined) {
          step.success = ev.success ?? true;
          step.resultPreview = ev.resultPreview;
          break;
        }
      }
      break;
    }
    case "done":
      rec.status = "done";
      rec.result = ev.result;
      break;
    case "failed":
      rec.status = "failed";
      rec.error = ev.error;
      break;
  }
}
