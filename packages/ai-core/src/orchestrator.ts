/**
 * Orchestrator - The missing glue connecting context engine → agent
 * Single entry point: runWithContext(branch, query) → agent stream
 */
import type { Router } from "@ai-studio/providers";
import type { ToolRegistry } from "@ai-studio/tools-runtime";
import type { Store, GlobalMemory } from "@ai-studio/database";
import type { MetaGraph } from "@ai-studio/graph-engine";
import { buildPayload } from "@ai-studio/prompt-engine";
import { Agent, type AgentStreamEvent, type AgentConfig } from "./agent.js";
import { CostTracker } from "./costs.js";

// Lazy imports for modules that may not have been built yet
async function getFileReferences() {
  try { return await import("@ai-studio/prompt-engine"); } catch { return null; }
}
async function getPruning() {
  try { return await import("@ai-studio/prompt-engine"); } catch { return null; }
}

export interface OrchestratorConfig {
  store: Store;
  router: Router;
  registry: ToolRegistry;
  graph?: MetaGraph;
  globalMemory?: GlobalMemory;
  projectRoot?: string;
  /** Base system prompt prepended to context */
  systemPrompt?: string;
  /** Agent persona config */
  persona?: { name: string; systemPrompt: string };
  /** Permission handler */
  onPermission?: AgentConfig["onPermission"];
}

export interface RunOptions {
  branchId: string;
  query: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Run the full pipeline: resolve files → build context → prune → agent loop
 */
export async function* runWithContext(
  config: OrchestratorConfig,
  options: RunOptions,
): AsyncGenerator<AgentStreamEvent> {
  const { store, router, registry, graph, globalMemory, projectRoot } = config;
  const branch = store.getBranch(options.branchId);
  if (!branch) throw new Error(`Branch not found: ${options.branchId}`);

  const model = options.model ?? branch.model;

  // 1. Expand @file references in the user query
  let expandedQuery = options.query;
  if (projectRoot) {
    const mod = await getFileReferences();
    if (mod?.expandFileReferences) expandedQuery = await mod.expandFileReferences(options.query, projectRoot);
  }

  // 2. Save user message
  const msg = store.addMessage(branch.id, "user", expandedQuery);
  const messageId = msg.id;

  // 3. Build context payload (summaries, ancestry, graph retrieval, memory, pins)
  const payload = await buildPayload(store, branch, graph, globalMemory, options.query);

  // 4. Prune large tool outputs in history
  const mod = await getPruning();
  const prunedMessages = mod?.pruneToolOutputs
    ? mod.pruneToolOutputs(payload.messages.map(m => ({ role: m.role, content: m.content })))
    : payload.messages.map(m => ({ role: m.role, content: m.content }));

  // 5. Build system prompt
  const systemParts: string[] = [];
  if (config.persona?.systemPrompt) systemParts.push(config.persona.systemPrompt);
  else if (config.systemPrompt) systemParts.push(config.systemPrompt);
  if (payload.systemContext) systemParts.push(payload.systemContext);
  const system = systemParts.join("\n\n");

  // 6. Run agent with full context
  const costTracker = new CostTracker();
  const agent = new Agent(router, registry, {
    sessionId: branch.id,
    messageId,
    agent: config.persona?.name ?? "default",
    costTracker,
    onPermission: config.onPermission,
  });

  let finalText = "";
  for await (const event of agent.run(model, prunedMessages, system, options.signal)) {
    yield event;
    if (event.type === "done") finalText = event.result.text;
  }

  // 7. Save assistant response
  if (finalText) {
    store.addMessage(branch.id, "assistant", finalText, model);
  }

  // 8. Record cost
  const tokens = costTracker.totalTokens;
  if (tokens.input + tokens.output > 0) {
    store.recordCost(branch.id, model, tokens.input, tokens.output, costTracker.totalCost);
  }
}
