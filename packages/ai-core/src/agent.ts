import type { Router, ProviderMessage, StreamEvent, ContentBlock } from "@ai-studio/providers";
import { contentToText } from "@ai-studio/providers";
import type { ToolRegistry } from "@ai-studio/tools-runtime";
import { CostTracker } from "./costs.js";

export interface ToolContext {
  sessionId: string;
  messageId: string;
  callId?: string;
  agent: string;
  abort: AbortSignal;
  metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
  ask: (request: { permission: string; description: string }) => Promise<void>;
}

export interface AgentResult {
  text: string;
  iterations: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string; success: boolean }>;
  cost?: string;
}

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string; success: boolean }
  | { type: "tool_call_streaming"; name: string; bytesReceived: number }
  | { type: "done"; result: AgentResult };

export interface AgentConfig {
  maxIterations?: number;
  sessionId?: string;
  messageId?: string;
  agent?: string;
  /** Permission handler - called when a tool needs approval */
  onPermission?: (req: { tool: string; description: string }) => Promise<void>;
  /** Track costs */
  costTracker?: CostTracker;
}

function validateResponse(
  text: string,
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>,
  userMessage: string,
): string | null {
  // Only nudge "act, don't ask" when the user actually requested an action.
  // Informational/conversational questions (e.g. "what tools do you have?")
  // must not be hijacked into a forced tool execution.
  const isActionRequest =
    /\b(fix|change|update|add|implement|create|refactor|rewrite|write|make|build|delete|remove|rename|apply|edit|modify|install|run|generate|deploy|migrate|configure|set\s?up|scaffold)\b/i.test(
      userMessage,
    );

  // A genuine deflection is SHORT — the model asked instead of answering
  // ("Would you like me to fix this now?"). A longer response that merely
  // ends with "if you want, I can…" is a complete answer with a closing offer
  // (itineraries, research summaries, …); flagging it destroys the whole
  // reply, because the correction path drops the draft.
  const isDeflection = text.trim().length < 400;

  if (isActionRequest && isDeflection) {
    const confirmPatterns = [
      /if you want,?\s*i can/i, /shall i (proceed|go ahead|do|apply|fix|update|change)/i,
      /would you like me to/i, /want me to (apply|do|fix|change|update|proceed)/i,
      /let me know if you('d like| want)/i,
    ];
    for (const pat of confirmPatterns) {
      if (pat.test(text)) return "[SYSTEM] You asked for confirmation instead of acting. Execute the change NOW using tools.";
    }
  }

  const actionClaims = [/i (changed|updated|applied|modified|edited|rewrote|replaced|fixed)/i, /(done|applied|updated|changed)\s*✅/i];
  const writeTools = ["write_file", "edit_file", "patch", "bash", "apply_patch"];
  const hasWriteCall = toolCalls.some(tc => writeTools.includes(tc.name));
  if (!hasWriteCall) {
    for (const pat of actionClaims) {
      if (pat.test(text)) return "[SYSTEM] You claimed changes but did NOT call write tools. This is a hallucination. Call write_file/edit_file NOW.";
    }
  }
  return null;
}

export class Agent {
  private router: Router;
  private tools: ToolRegistry;
  private config: AgentConfig;

  constructor(router: Router, tools: ToolRegistry, config: AgentConfig = {}) {
    this.router = router;
    this.tools = tools;
    this.config = { maxIterations: 10, ...config };
  }

  getRegistry(): ToolRegistry { return this.tools; }

  async *run(
    model: string,
    messages: Array<{ role: string; content: string | ContentBlock[] }>,
    system: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent> {
    // Content (string or text+image blocks) is already resolved by the caller;
    // pass it straight through. Image blocks reach the provider adapters, which
    // translate them to each wire format.
    const history: ProviderMessage[] = messages.map(m => ({ role: m.role as any, content: m.content }));

    const toolDefs = this.tools.getDefinitions();
    const allToolCalls: AgentResult["toolCalls"] = [];
    // Latest user turn — used to decide whether "act, don't ask" nudges apply.
    // Flatten to text: the nudge heuristics only inspect words, not images.
    const lastUserMessage = contentToText([...messages].reverse().find(m => m.role === "user")?.content ?? "");
    let iterations = 0;
    // The reply is EVERYTHING the model wrote across iterations, not just the
    // last chunk: models routinely write a long answer, then call a tool, then
    // add a short follow-up — overwriting per iteration dropped the answer.
    const textParts: string[] = [];
    const maxIter = this.config.maxIterations!;

    while (iterations < maxIter) {
      iterations++;
      let text = "";
      const pendingToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      for await (const event of this.router.stream(model, history, system, toolDefs.length ? toolDefs : undefined, signal)) {
        if (event.type === "text") { text += event.text; yield { type: "text", text: event.text }; }
        else if (event.type === "tool_call") { pendingToolCalls.push(event); }
        else if (event.type === "tool_call_streaming") { yield event; }
        else if (event.type === "usage" && this.config.costTracker) { this.config.costTracker.record(model, event.usage); }
      }

      if (!pendingToolCalls.length) {
        const correction = validateResponse(text, allToolCalls, lastUserMessage);
        if (correction && iterations < maxIter) {
          // Rejected draft: it goes back to the model for correction but is
          // deliberately NOT part of the reply — keeping it would duplicate
          // whatever the corrected iteration says.
          history.push({ role: "assistant", content: text });
          history.push({ role: "user", content: correction });
          continue;
        }
        if (text) textParts.push(text);
        break;
      }

      if (text) textParts.push(text);
      history.push({ role: "assistant", content: text, toolCalls: pendingToolCalls });

      for (const tc of pendingToolCalls) {
        yield { type: "tool_start", name: tc.name, args: tc.arguments };

        const ctx: ToolContext = {
          sessionId: this.config.sessionId ?? "",
          messageId: this.config.messageId ?? "",
          callId: tc.id,
          agent: this.config.agent ?? "default",
          abort: signal ?? new AbortController().signal,
          metadata: () => {},
          ask: async (req: { permission: string; description: string }) => {
            if (this.config.onPermission) await this.config.onPermission({ tool: tc.name, description: req.description });
          },
        };

        const result = await this.tools.execute(tc.name, tc.arguments, ctx);
        const output = result.output;
        const success = !(result as any).metadata?.error;
        allToolCalls.push({ name: tc.name, args: tc.arguments, result: output, success });
        yield { type: "tool_end", name: tc.name, result: output, success };
        history.push({ role: "tool_result", content: output, toolCallId: tc.id });
      }
    }

    yield { type: "done", result: { text: textParts.join("\n\n"), iterations, toolCalls: allToolCalls, cost: this.config.costTracker?.lastCost() } };
  }
}
