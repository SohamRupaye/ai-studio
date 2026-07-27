/**
 * Engine dispatch.
 *
 * The native loop (`Agent.run` via `runAgentCooperative`) stays the default for
 * every provider and every model. The Claude subscription engine is reached
 * only when all three hold:
 *
 *   1. the user explicitly enabled it (config `claude_subscription_engine`),
 *   2. the selected model is a first-party Claude id, and
 *   3. a local Claude Code session appears to exist.
 *
 * Anything else falls back to native with a stated reason — a silent downgrade
 * would leave the user wondering which engine ran.
 */
import type { ContentBlock } from "@squirl/providers";
import { detectLocalClaudeSession, isClaudeSubscriptionModel } from "@squirl/providers";
import type { Agent, AgentStreamEvent } from "./agent.js";
import { runClaudeSdkEngine } from "./engines/claude-sdk.js";
import { runAgentCooperative } from "./worker.js";

export type EngineName = "native" | "claude-sdk";

export interface EngineSelection {
  engine: EngineName;
  /** Why this engine won — logged so a fallback to native is never mysterious. */
  reason: string;
}

export function selectEngine(opts: {
  model: string;
  subscriptionEngineEnabled: boolean;
}): EngineSelection {
  if (!opts.subscriptionEngineEnabled) {
    return { engine: "native", reason: "subscription engine not enabled" };
  }
  // Only the namespaced `claude_subscription/…` ids route here. A bare
  // `claude-*` id comes from the API-key `anthropic` entry and must stay on the
  // native loop so BYOK keeps its billing, tool transparency and guard.
  if (!isClaudeSubscriptionModel(opts.model)) {
    return { engine: "native", reason: `${opts.model} is not a subscription model` };
  }
  const session = detectLocalClaudeSession();
  if (!session.signedIn) {
    return { engine: "native", reason: "no local Claude Code session detected" };
  }
  return { engine: "claude-sdk", reason: `local session (${session.detectedVia})` };
}

export interface RunTurnOptions {
  /** Config opt-in. Absent/false keeps every turn on the native loop. */
  subscriptionEngineEnabled?: boolean;
  /** Identifies Squirl in the SDK's User-Agent. */
  clientApp?: string;
  /** Observability hook — receives the selection for every turn. */
  onEngineSelected?: (selection: EngineSelection) => void;
}

/**
 * Single entry point for a chat turn. Signature matches `runAgentCooperative`
 * so the call site in chat.ts only changes which function it names.
 */
export async function* runTurn(
  agent: Agent,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  system: string,
  signal?: AbortSignal,
  opts: RunTurnOptions = {},
): AsyncGenerator<AgentStreamEvent> {
  const selection = selectEngine({
    model,
    subscriptionEngineEnabled: opts.subscriptionEngineEnabled === true,
  });
  opts.onEngineSelected?.(selection);

  if (selection.engine === "claude-sdk") {
    yield* runClaudeSdkEngine(agent, model, messages, system, signal, {
      clientApp: opts.clientApp,
    });
    return;
  }

  yield* runAgentCooperative(agent, model, messages, system, signal);
}
