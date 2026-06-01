import type { Router } from "@ai-studio/providers";
import type { ToolRegistry } from "@ai-studio/tools-runtime";
import { Agent } from "./agent.js";

let _runTask: ((task: string, model: string, systemPrompt: string, allowedTools?: string[]) => Promise<string>) | null = null;
let _defaultModel = "";

export function setSubagentDependencies(runTask: typeof _runTask, defaultModel: string) {
  _runTask = runTask;
  _defaultModel = defaultModel;
}

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

  _runTask = runTask;
  _defaultModel = defaultModel;
  return { runTask };
}
