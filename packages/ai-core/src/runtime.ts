import type { Router } from "@squirl/providers";
import { setSubagentDependencies, type ToolRegistry, type SubagentRunMeta } from "@squirl/tools-runtime";
import type { SubagentStreamEvent } from "@squirl/shared";
import { Agent } from "./agent.js";

export type SubagentEvent = SubagentStreamEvent;
export type SubagentEventHandler = (event: SubagentEvent) => void;

/** An agent that idles in a tool loop (e.g. told to "work for a minute") or a
 * hung provider call must not run forever — no event for this long kills the
 * run. Callers override per tool (delegate allows longer). */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Compact one-line preview for the transcript — full values still reach the
 * model; this is only what travels to the UI. */
function preview(value: unknown, cap = 400): string {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

export function createRuntime(
  router: Router,
  registry: ToolRegistry,
  defaultModel: string,
  onSubagentEvent?: SubagentEventHandler,
) {
  const BLOCKED = new Set(["subagent", "delegate", "delegate_result", "delegate_list"]);
  const emit = (event: SubagentEvent) => {
    try { onSubagentEvent?.(event); } catch { /* observer errors must not kill the run */ }
  };

  const runTask = async (task: string, model: string, systemPrompt: string, allowedTools?: string[], meta?: SubagentRunMeta): Promise<string> => {
    const { ToolRegistry: TR } = await import("@squirl/tools-runtime");
    const subReg = new TR();
    for (const def of registry.getDefinitions()) {
      if (BLOCKED.has(def.name)) continue;
      if (allowedTools && !allowedTools.includes(def.name)) continue;
      const name = def.name;
      subReg.register(def, async (args: Record<string, unknown>) => {
        const ctx = { sessionId: "sub", messageId: "sub", agent: "subagent", abort: new AbortController().signal, metadata: () => {}, ask: async () => {} };
        const result = await registry.execute(name, args, ctx);
        return result.output;
      });
    }
    const system = systemPrompt || "You are a focused AI agent. Complete the assigned task thoroughly.";
    const ids = meta ? { runId: meta.runId, agentId: meta.agentId } : { runId: "adhoc", agentId: "task" };
    const timeoutMs = meta?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timedOut = () => new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);

    const runOnce = async (onModel: string): Promise<string> => {
      const agent = new Agent(router, subReg, { maxIterations: 15 });
      let finalText = "";
      for await (const event of agent.run(onModel, [{ role: "user", content: task }], system, controller.signal)) {
        // Providers get the signal too; this check is the backstop for ones
        // that ignore it — the run dies at the next event either way.
        if (controller.signal.aborted) throw timedOut();
        if (event.type === "text" && event.text) emit({ ...ids, status: "text", text: event.text });
        else if (event.type === "tool_start") emit({ ...ids, status: "tool", tool: event.name, args: preview(event.args) });
        else if (event.type === "tool_end") emit({ ...ids, status: "tool_end", tool: event.name, success: event.success, resultPreview: preview(event.result) });
        else if (event.type === "done") finalText = event.result.text;
      }
      return finalText || "(Agent produced no output)";
    };

    emit({ ...ids, status: "start", task, model });
    try {
      let text: string;
      try {
        text = await runOnce(model);
      } catch (err) {
        if (controller.signal.aborted) throw timedOut();
        // The delegating model routinely invents model ids ("current",
        // "gpt-4.1-mini"); an unknown model must degrade to the chat's own
        // model, not kill the delegation. Caught at run level (not a
        // pre-check) so prefix routing and live model-list refresh in the
        // router keep working.
        const message = err instanceof Error ? err.message : String(err);
        if (!/No provider for model/i.test(message) || model === defaultModel || !defaultModel) throw err;
        emit({ ...ids, status: "start", task, model: defaultModel });
        const text2 = await runOnce(defaultModel);
        text = `(Requested model "${model}" isn't available here — ran on "${defaultModel}".)\n\n${text2}`;
      }
      emit({ ...ids, status: "done", result: text });
      return text;
    } catch (err) {
      emit({ ...ids, status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  // The registered subagent/delegate tools live in tools-runtime and read
  // ITS module state — inject there. (History: this used to set a private
  // ai-core copy of the same variables that nothing read, so every
  // subagent/delegate call errored "dependencies not initialized" and the
  // agent's multi-model delegation was dead.) chat:send calls createRuntime
  // per turn, so subagents inherit the current branch's router and model;
  // each delegated task may override with its own `model`.
  setSubagentDependencies(runTask, defaultModel);
  return { runTask };
}
