/**
 * Claude models served by the user's own local Claude Code login.
 *
 * This is a CATALOGUE ENTRY, not an inference path. Chat turns for these ids are
 * intercepted before the Router by `runTurn` in `@squirl/ai-core`, which runs the
 * Agent SDK engine — the only place the SDK's tool loop lives. The entry exists
 * so the models are selectable at all: without it there is no `claude*` router
 * entry unless an Anthropic API key is configured, and the engine is unreachable.
 *
 * Registered NAMESPACED (`claude_subscription/claude-opus-4-8`) so it can coexist
 * with the API-key `anthropic` entry rather than shadowing it — the two are
 * billed differently and the picker has to be able to say which is which.
 *
 * Reaching `call()`/`stream()` here therefore means something OTHER than a chat
 * turn asked for a subscription model — background summarisation, auto-title, a
 * subagent. Those deliberately do not spend subscription quota, so they fail
 * loudly with an actionable message instead of silently degrading. Utility call
 * sites route around this via `utilityModelFor` before they ever hit the Router.
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export const CLAUDE_SUBSCRIPTION_ENTRY = "claude_subscription";
const NAMESPACE = `${CLAUDE_SUBSCRIPTION_ENTRY}/`;

/**
 * Static list. Which models a given plan may actually use is decided by
 * Anthropic at request time, and the SDK's own `supportedModels()` needs a
 * spawned query to answer — not worth a subprocess just to populate a menu. A
 * model listed here but unavailable to the plan fails loudly on first use.
 */
export const CLAUDE_SUBSCRIPTION_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

/** True for a namespaced subscription model id. */
export function isClaudeSubscriptionModel(model: string): boolean {
  return model.startsWith(NAMESPACE);
}

/** Strip the router namespace to the bare id the Agent SDK expects. */
export function bareClaudeModel(model: string): string {
  return isClaudeSubscriptionModel(model) ? model.slice(NAMESPACE.length) : model;
}

/**
 * Background work (titles, summaries, memory detection) inherits a branch's
 * pinned model, which would quietly spend subscription quota on chores. Swap
 * subscription ids for the configured utility model at those call sites.
 */
export function utilityModelFor(model: string, fallback: string): string {
  return isClaudeSubscriptionModel(model) ? fallback : model;
}

function unsupported(model: string): never {
  throw new Error(
    `${model} runs on your Claude subscription, which Squirl uses for chat turns only. ` +
      `Background work (titles, summaries, memory detection) and subagents stay on a regular ` +
      `model — pick a non-subscription model for those, or add an Anthropic API key.`,
  );
}

export class ClaudeSubscriptionProvider implements Provider {
  async call(
    model: string,
    _messages?: ProviderMessage[],
    _system?: string,
  ): Promise<{ text: string; toolCalls: unknown[]; usage: unknown }> {
    unsupported(model);
  }

  async *stream(model: string): AsyncGenerator<StreamEvent> {
    unsupported(model);
  }

  async listModels(): Promise<string[]> {
    return [...CLAUDE_SUBSCRIPTION_MODELS];
  }
}
