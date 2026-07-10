/**
 * Agent Worker — runs the agent loop in a Worker thread to avoid blocking
 * the Electron main process during long tool executions.
 *
 * Usage: Instead of running the agent loop directly in the IPC handler,
 * post work to this worker and receive events back via MessagePort.
 *
 * Note: For Electron's architecture, we use a utility process or run
 * the agent in a setTimeout-yielding pattern since better-sqlite3 doesn't
 * work in Worker threads. We use cooperative yielding instead.
 */

import type { Agent } from "./agent.js";
import type { AgentStreamEvent } from "./agent.js";
import type { ContentBlock } from "@ai-studio/providers";

/**
 * Run the agent loop with cooperative yielding to prevent blocking the event loop.
 * Yields control back to the event loop between tool executions.
 */
export async function* runAgentCooperative(
  agent: Agent,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  system: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  for await (const event of agent.run(model, messages, system, signal)) {
    yield event;
    // Yield to event loop after tool completions to keep UI responsive
    if (event.type === "tool_end") {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}
