import type { Router } from "@ai-studio/providers";
import { setSubagentDependencies, type ToolRegistry } from "@ai-studio/tools-runtime";
import { Agent } from "./agent.js";

export function createRuntime(router: Router, registry: ToolRegistry, defaultModel: string) {
  const BLOCKED = new Set(["subagent", "delegate", "delegate_result", "delegate_list"]);

  const runTask = async (task: string, model: string, systemPrompt: string, allowedTools?: string[]): Promise<string> => {
    const { ToolRegistry: TR } = await import("@ai-studio/tools-runtime");
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
    const agent = new Agent(router, subReg, { maxIterations: 15 });
    const system = systemPrompt || "You are a focused AI agent. Complete the assigned task thoroughly.";
    let finalText = "";
    for await (const event of agent.run(model, [{ role: "user", content: task }], system)) {
      if (event.type === "done") finalText = event.result.text;
    }
    return finalText || "(Agent produced no output)";
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
