/**
 * thinking.ts — Internal reasoning scratchpad.
 *
 * Gives the model an explicit place to think through complex problems
 * before acting. The output is returned to the model (not the user)
 * as structured reasoning context.
 *
 * Why this matters:
 * - Forces explicit decomposition before action
 * - The model can surface uncertainty, list options, weigh tradeoffs
 * - Returns a structured plan the next tool calls can reference
 * - Costs nothing extra — the "thinking" text is just the model's own output
 */

import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

export const thinkDef: ToolDefinition = {
  name: "think",
  description: "Internal reasoning scratchpad. Use this BEFORE complex multi-step operations to plan your approach, identify risks, list unknowns, and decide on the best sequence of tool calls. The output is only visible to you — it will NOT be shown to the user. Use it freely for any non-trivial task. Example uses: planning a refactor, deciding between approaches, analyzing a bug before fixing it, understanding a codebase structure before editing.",
  parameters: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "Your internal reasoning. Think step-by-step: what do you know, what are you uncertain about, what's the best approach, what risks exist, what's the sequence of actions.",
      },
      plan: {
        type: "array",
        items: { type: "string" },
        description: "Optional ordered list of concrete steps you plan to take after thinking.",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of risks or edge cases to be careful about.",
      },
    },
    required: ["reasoning"],
  },
};

export const think: ToolHandler = async (args) => {
  const reasoning = args["reasoning"] as string;
  const plan = args["plan"] as string[] | undefined;
  const risks = args["risks"] as string[] | undefined;

  const parts = [`[THINKING]\n${reasoning}`];

  if (plan?.length) {
    parts.push(`\n[PLAN]\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }

  if (risks?.length) {
    parts.push(`\n[RISKS]\n${risks.map(r => `⚠ ${r}`).join("\n")}`);
  }

  parts.push("\n[Proceed with your plan using the appropriate tool calls.]");
  return parts.join("\n");
};
