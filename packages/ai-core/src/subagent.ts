/**
 * Subagent Isolation - Token budget, time limit, output validation
 */
import type { Router } from "@squirl/providers";
import type { ToolRegistry } from "@squirl/tools-runtime";
import { Agent, type AgentConfig } from "./agent.js";
import { CostTracker } from "./costs.js";

export interface SubagentConstraints {
  /** Max tokens the subagent can consume (input + output). Default: 50000 */
  tokenBudget?: number;
  /** Max wall-clock time in ms. Default: 120000 (2 min) */
  timeLimit?: number;
  /** Max iterations. Default: 15 */
  maxIterations?: number;
  /** Required output format validation */
  outputSchema?: { required?: string[]; maxLength?: number };
  /** Tools the subagent is allowed to use */
  allowedTools?: string[];
  /** Tools explicitly blocked */
  blockedTools?: string[];
}

const DEFAULTS: Required<Omit<SubagentConstraints, "outputSchema" | "allowedTools" | "blockedTools">> = {
  tokenBudget: 50_000,
  timeLimit: 120_000,
  maxIterations: 15,
};

export async function runIsolatedSubagent(
  router: Router,
  registry: ToolRegistry,
  task: string,
  model: string,
  systemPrompt: string,
  constraints: SubagentConstraints = {},
): Promise<{ output: string; tokens: number; duration: number; truncated: boolean }> {
  const cfg = { ...DEFAULTS, ...constraints };
  const startTime = Date.now();

  // Build restricted registry
  const ALWAYS_BLOCKED = new Set(["subagent", "delegate", "delegate_result", "delegate_list"]);
  const blocked = new Set([...ALWAYS_BLOCKED, ...(cfg.blockedTools ?? [])]);

  const { ToolRegistry: TR } = await import("@squirl/tools-runtime");
  const subReg = new TR();
  for (const def of registry.getDefinitions()) {
    if (blocked.has(def.name)) continue;
    if (cfg.allowedTools && !cfg.allowedTools.includes(def.name)) continue;
    const name = def.name;
    subReg.register(def, async (args: Record<string, unknown>) => {
      const ctx = { sessionId: "sub", messageId: "sub", agent: "subagent", abort: controller.signal, metadata: () => {}, ask: async () => {} };
      const result = await registry.execute(name, args, ctx);
      return result.output;
    });
  }

  // Create abort controller with time limit
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeLimit);

  const costTracker = new CostTracker();
  const agent = new Agent(router, subReg, {
    maxIterations: cfg.maxIterations,
    costTracker,
    sessionId: "subagent",
    agent: "subagent",
  });

  let output = "";
  let truncated = false;

  try {
    for await (const event of agent.run(model, [{ role: "user", content: task }], systemPrompt, controller.signal)) {
      if (event.type === "done") output = event.result.text;

      // Check token budget
      const tokens = costTracker.totalTokens;
      if (tokens.input + tokens.output > cfg.tokenBudget) {
        controller.abort();
        truncated = true;
        break;
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") truncated = true;
    else throw err;
  } finally {
    clearTimeout(timeout);
  }

  // Validate output
  if (cfg.outputSchema) {
    if (cfg.outputSchema.maxLength && output.length > cfg.outputSchema.maxLength) {
      output = output.slice(0, cfg.outputSchema.maxLength) + "\n[truncated by subagent output limit]";
      truncated = true;
    }
  }

  const duration = Date.now() - startTime;
  const totalTokens = costTracker.totalTokens;
  return { output: output || "(no output)", tokens: totalTokens.input + totalTokens.output, duration, truncated };
}
