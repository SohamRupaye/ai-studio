/**
 * Slash Commands - /compact, /cost, /model, /memory, /clear, /persona, /help
 */
import type { Store, GlobalMemory } from "@squirl/database";
import { shouldSummarize, runPendingSummaries } from "@squirl/prompt-engine";
import type { Router } from "@squirl/providers";
import type { CostTracker } from "./costs.js";
import type { PersonaRegistry } from "./personas.js";

export interface CommandContext {
  store: Store;
  router: Router;
  branchId: string;
  globalMemory?: GlobalMemory;
  costTracker?: CostTracker;
  personas?: PersonaRegistry;
  onModelChange?: (model: string) => void;
}

export interface CommandResult {
  output: string;
  handled: boolean;
}

type CommandHandler = (args: string, ctx: CommandContext) => Promise<CommandResult>;

const commands = new Map<string, { description: string; handler: CommandHandler }>();

function register(name: string, description: string, handler: CommandHandler) {
  commands.set(name, { description, handler });
}

register("help", "Show available commands", async () => {
  const lines = ["**Available Commands:**"];
  for (const [name, { description }] of commands) lines.push(`  /${name} — ${description}`);
  return { output: lines.join("\n"), handled: true };
});

register("compact", "Force context compaction now", async (_, ctx) => {
  const { store, router, branchId } = ctx;
  if (!shouldSummarize(store, branchId)) return { output: "Nothing to compact (too few messages).", handled: true };
  await runPendingSummaries(store, router, branchId);
  return { output: "✓ Context compacted. Older messages summarized.", handled: true };
});

register("cost", "Show token usage and cost for this session", async (_, ctx) => {
  if (!ctx.costTracker) {
    const costs = ctx.store.getCosts(ctx.branchId);
    if (!costs.length) return { output: "No cost data recorded yet.", handled: true };
    const total = costs.reduce((s, c) => s + c.costUsd, 0);
    const input = costs.reduce((s, c) => s + c.inputTokens, 0);
    const output = costs.reduce((s, c) => s + c.outputTokens, 0);
    return { output: `Cost: $${total.toFixed(4)} | Tokens: ${input.toLocaleString()} in / ${output.toLocaleString()} out | Calls: ${costs.length}`, handled: true };
  }
  return { output: ctx.costTracker.summary(), handled: true };
});

register("model", "Switch model (e.g. /model gpt-4o)", async (args, ctx) => {
  const model = args.trim();
  if (!model) {
    const branch = ctx.store.getBranch(ctx.branchId);
    return { output: `Current model: ${branch?.model ?? "unknown"}`, handled: true };
  }
  ctx.store.updateBranchModel(ctx.branchId, model);
  ctx.onModelChange?.(model);
  return { output: `✓ Model switched to: ${model}`, handled: true };
});

register("memory", "Manage memories (/memory add <text>, /memory list, /memory remove <id>)", async (args, ctx) => {
  if (!ctx.globalMemory) return { output: "Memory system not configured.", handled: true };
  const [action, ...rest] = args.trim().split(" ");
  const text = rest.join(" ");

  switch (action) {
    case "add": {
      if (!text) return { output: "Usage: /memory add <text>", handled: true };
      const fact = ctx.globalMemory.add(text, `branch:${ctx.branchId}`);
      return { output: `✓ Memory #${fact.id} added: "${text}"`, handled: true };
    }
    case "list": {
      const facts = ctx.globalMemory.forBranch(ctx.branchId);
      if (!facts.length) return { output: "No memories stored.", handled: true };
      const lines = facts.map(f => `  #${f.id} [${f.scope}] ${f.text}`);
      return { output: `**Memories (${facts.length}):**\n${lines.join("\n")}`, handled: true };
    }
    case "remove": case "delete": {
      const id = parseInt(text);
      if (isNaN(id)) return { output: "Usage: /memory remove <id>", handled: true };
      const ok = ctx.globalMemory.remove(id);
      return { output: ok ? `✓ Memory #${id} removed.` : `Memory #${id} not found.`, handled: true };
    }
    default:
      return { output: "Usage: /memory [add|list|remove]", handled: true };
  }
});

register("clear", "Clear conversation (keeps memories and summaries)", async (_, ctx) => {
  // Delete all messages but keep summaries
  const messages = ctx.store.getMessages(ctx.branchId);
  for (const m of messages) {
    ctx.store.deleteLastMessage(ctx.branchId);
  }
  return { output: `✓ Cleared ${messages.length} messages.`, handled: true };
});

register("persona", "Switch agent persona (/persona list, /persona <name>)", async (args, ctx) => {
  if (!ctx.personas) return { output: "Persona system not configured.", handled: true };
  const name = args.trim();
  if (!name || name === "list") {
    const list = ctx.personas.list();
    const lines = list.map(p => `  **${p.name}**${p.description ? ` — ${p.description}` : ""}`);
    return { output: `**Available Personas:**\n${lines.join("\n")}`, handled: true };
  }
  const persona = ctx.personas.get(name);
  if (!persona) return { output: `Persona "${name}" not found. Use /persona list.`, handled: true };
  return { output: `✓ Switched to persona: **${persona.name}**${persona.model ? ` (model: ${persona.model})` : ""}`, handled: true };
});

/**
 * Process a user message — if it starts with /, handle as command
 * Returns null if not a command
 */
export async function processCommand(input: string, ctx: CommandContext): Promise<CommandResult | null> {
  if (!input.startsWith("/")) return null;
  const [cmd, ...rest] = input.slice(1).split(" ");
  const handler = commands.get(cmd!);
  if (!handler) return { output: `Unknown command: /${cmd}. Type /help for available commands.`, handled: true };
  return handler.handler(rest.join(" "), ctx);
}

export function listCommands(): Array<{ name: string; description: string }> {
  return Array.from(commands.entries()).map(([name, { description }]) => ({ name, description }));
}
