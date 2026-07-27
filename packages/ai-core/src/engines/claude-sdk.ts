/**
 * Claude subscription engine — the Agent SDK as a second inference+tool loop.
 *
 * WHAT THIS IS NOT: there is no "Sign in with Claude" here. Squirl registers no
 * OAuth client, runs no authorization flow, and stores no token. The user signs
 * into Anthropic's own Claude Code; the Agent SDK resolves whatever credentials
 * that wrote. See engines/local-session.ts, and `context/debt.md` for why that
 * distinction is the whole point.
 *
 * Shape: one `query()` per turn, with Squirl's prompt-engine payload serialized
 * in. The SDK's own session management is deliberately bypassed — branches,
 * memories and artifacts are Squirl's product, not the SDK's.
 *
 * Two honesty gaps ride along, both structural rather than oversights:
 *
 *  1. `validateResponse` (the hallucination guard in agent.ts) cannot run here.
 *     It works by pushing a rejected draft plus a correction back into history
 *     and re-entering the loop; the SDK owns its loop and exposes no such seam.
 *     SDK turns are therefore unguarded.
 *  2. The right panel's ContextStats are captured pre-flight in chat.ts, so the
 *     numbers still render — but they describe what Squirl SENT, not what the
 *     model saw. The SDK may compact or inject on its own.
 *
 * Fidelity limit: only the latest turn keeps native image/document blocks. The
 * SDK prompt is a single user message, so earlier turns are serialized to text
 * and their images degrade to `[image]` placeholders via contentToText.
 */
import {
  createSdkMcpServer,
  query,
  tool,
  type McpServerConfig,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { bareClaudeModel, contentToText, toAnthropicContent, type ContentBlock } from "@squirl/providers";
import type { ToolContext, ToolRegistry } from "@squirl/tools-runtime";
import type { Agent, AgentResult, AgentStreamEvent } from "../agent.js";
import { jsonSchemaToZodShape } from "./json-schema-to-zod.js";

/**
 * `apiKeySource` on the SDK's init message says where an API KEY came from.
 *
 * Under a local Claude Code subscription login there IS no API key, and the SDK
 * reports `"none"` — verified against SDK 0.3.220, where a `"none"` turn
 * completes normally. `"none"` isn't even in the declared `ApiKeySource` union,
 * which is why this is a deny-list rather than an allow-list: allow-listing
 * `"oauth"` rejected every real subscription turn, and allow-listing any fixed
 * set would break again the next time the SDK adds a source string.
 *
 * These four are the documented sources that mean a real key is being billed.
 * The engine also strips `ANTHROPIC_API_KEY` from the subprocess, so a key can
 * only reach the SDK via settings files or a temporary credential.
 */
const BILLED_API_KEY_SOURCES = new Set(["user", "project", "org", "temporary"]);

/** In-process MCP server name. Tools reach the model as `mcp__squirl__<id>`. */
const MCP_SERVER = "squirl";
const TOOL_PREFIX = `mcp__${MCP_SERVER}__`;

/**
 * Squirl's renderer, `redactToolArgs`, the persisted tool rows and
 * `validateResponse`'s write-tool list all key on BARE tool ids. Strip the MCP
 * namespace before any event leaves this module.
 */
function bareToolName(sdkName: string): string {
  return sdkName.startsWith(TOOL_PREFIX) ? sdkName.slice(TOOL_PREFIX.length) : sdkName;
}

/** The SDK wants an AbortController; the rest of Squirl passes an AbortSignal. */
function controllerFor(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!signal) return controller;
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

/** A tool_result block's content is either a string or an array of text parts. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part: unknown) => {
      if (typeof part === "string") return part;
      const p = part as { type?: string; text?: string };
      return p.type === "text" ? (p.text ?? "") : "";
    })
    .join("");
}

/**
 * Bridge Squirl's registry into an in-process MCP server. Every handler routes
 * through `registry.execute`, so validation, approval hooks, output truncation
 * and observability all behave exactly as they do on the native loop.
 */
function buildToolServer(
  registry: ToolRegistry,
  ctxFor: (toolId: string) => ToolContext,
): { server: McpServerConfig; toolNames: string[] } {
  const defs = registry.getDefinitions();
  const tools = defs.map(def =>
    tool(
      def.name,
      def.description,
      jsonSchemaToZodShape(def.parameters),
      async (args: unknown) => {
        const result = await registry.execute(def.name, args, ctxFor(def.name));
        return { content: [{ type: "text" as const, text: result.output }] };
      },
    ),
  );

  return {
    server: createSdkMcpServer({ name: MCP_SERVER, version: "0.1.0", tools }),
    toolNames: defs.map(d => `${TOOL_PREFIX}${d.name}`),
  };
}

/**
 * Serialize prior turns into a transcript block. The SDK takes a single user
 * message, so everything before the latest turn becomes text.
 */
function serializeHistory(
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
): string {
  if (!messages.length) return "";
  const lines = messages.map(m => `${m.role}: ${contentToText(m.content)}`);
  return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>\n\n`;
}

async function* singleTurnPrompt(
  history: Array<{ role: string; content: string | ContentBlock[] }>,
  latest: { role: string; content: string | ContentBlock[] } | undefined,
): AsyncIterable<SDKUserMessage> {
  const preamble = serializeHistory(history);
  const latestContent = latest ? toAnthropicContent(latest.content) : "";

  // toAnthropicContent returns a string for string content and an array of
  // blocks otherwise; the transcript preamble has to merge into either shape.
  const content = Array.isArray(latestContent)
    ? (preamble ? [{ type: "text", text: preamble }, ...latestContent] : latestContent)
    : `${preamble}${String(latestContent)}`;

  yield {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content },
  } as unknown as SDKUserMessage;
}

export interface ClaudeSdkEngineOptions {
  /** Mirrors AgentConfig.maxIterations so both engines stop at the same depth. */
  maxTurns?: number;
  /** Identifies Squirl in the SDK's User-Agent — the sanctioned alternative to
   * impersonating another client. */
  clientApp?: string;
}

/**
 * Drop-in replacement for `runAgentCooperative`: same arguments, same
 * `AgentStreamEvent` stream, so `chat.ts` needs no other change.
 */
export async function* runClaudeSdkEngine(
  agent: Agent,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  system: string,
  signal?: AbortSignal,
  opts: ClaudeSdkEngineOptions = {},
): AsyncGenerator<AgentStreamEvent> {
  const registry = agent.getRegistry();
  const controller = controllerFor(signal);

  const baseCtx: Omit<ToolContext, "callId"> = {
    sessionId: "",
    messageId: "",
    agent: "default",
    abort: controller.signal,
    metadata: () => {},
    // The SDK never routes permission prompts back to us (see permissionMode
    // below); Squirl's own approval hooks fire inside registry.execute.
    ask: async () => {},
  };

  const { server, toolNames } = buildToolServer(registry, () => ({ ...baseCtx }));

  const latest = messages[messages.length - 1];
  const prior = messages.slice(0, Math.max(0, messages.length - 1));

  // env REPLACES the subprocess environment rather than merging, so process.env
  // has to be spread explicitly. ANTHROPIC_API_KEY is stripped on purpose: the
  // user asked for subscription auth, and leaving a key in scope would silently
  // bill it instead.
  const { ANTHROPIC_API_KEY: _stripped, ...env } = process.env;

  const options: Options = {
    systemPrompt: system,
    // The router namespace (`claude_subscription/`) is Squirl's routing key, not
    // a model id — the SDK needs the bare alias.
    model: bareClaudeModel(model),
    mcpServers: { [MCP_SERVER]: server },
    // [] disables every built-in tool. Without this the model could Bash/Write
    // outside Squirl's tool system entirely, bypassing approvals and snapshots.
    tools: [],
    allowedTools: toolNames,
    permissionMode: "bypassPermissions",
    // [] is the SDK's isolation mode. Without it the CLI's defaults apply and
    // the user's own ~/.claude/CLAUDE.md, skills and project settings would
    // leak into Squirl's turns, corrupting what the prompt engine assembled.
    settingSources: [],
    // Squirl's chat UI streams token-by-token. Without partial messages the SDK
    // only emits whole assistant messages and the stream would visibly regress.
    includePartialMessages: true,
    maxTurns: opts.maxTurns ?? 10,
    abortController: controller,
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: opts.clientApp ?? "squirl" },
  };

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: AgentResult["toolCalls"] = [];
  const toolNameById = new Map<string, string>();
  let iterations = 0;
  let finalText = "";

  for await (const msg of query({ prompt: singleTurnPrompt(prior, latest), options })) {
    if (controller.signal.aborted) break;

    if (msg.type === "system" && msg.subtype === "init") {
      // Fail loudly rather than bill something the user didn't choose. The
      // filesystem probe in local-session.ts is a heuristic; this is the
      // authoritative source.
      if (BILLED_API_KEY_SOURCES.has(msg.apiKeySource)) {
        throw new Error(
          `Squirl requested Claude subscription auth, but the Agent SDK found an API key ` +
            `(source: "${msg.apiKeySource}") and would bill it. Remove the Anthropic key from ` +
            `your Claude Code settings, or turn off the Claude subscription toggle to use the key deliberately.`,
        );
      }
      continue;
    }

    if (msg.type === "stream_event") {
      // Live deltas for the UI only. Authoritative text is accumulated from the
      // buffered assistant message below — deltas are best-effort and may be
      // shed under load.
      const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
      if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          yield { type: "text", text: ev.delta.text };
        } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
          yield { type: "thinking", text: ev.delta.thinking };
        }
      }
      continue;
    }

    if (msg.type === "assistant") {
      iterations++;
      let text = "";
      let thinking = "";
      for (const block of msg.message.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "thinking") {
          thinking += block.thinking;
        } else if (block.type === "tool_use") {
          const name = bareToolName(block.name);
          toolNameById.set(block.id, name);
          yield { type: "tool_start", name, args: block.input as Record<string, unknown> };
        }
      }
      if (text) textParts.push(text);
      if (thinking.trim()) thinkingParts.push(thinking.trim());
      continue;
    }

    if (msg.type === "user") {
      const content = msg.message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (typeof block === "string" || block.type !== "tool_result") continue;
        const name = toolNameById.get(block.tool_use_id) ?? "tool";
        const output = toolResultText(block.content);
        const success = block.is_error !== true;
        toolCalls.push({ name, args: {}, result: output, success });
        yield { type: "tool_end", name, result: output, success };
      }
      continue;
    }

    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        throw new Error(`Agent SDK run failed (${msg.subtype}).`);
      }
      finalText = msg.result;
      iterations = msg.num_turns;
    }
  }

  yield {
    type: "done",
    result: {
      text: textParts.join("\n\n") || finalText,
      iterations,
      toolCalls,
      thinking: thinkingParts.length ? thinkingParts.join("\n\n") : undefined,
      // Deliberately unset: on subscription auth nothing is billed per token,
      // so reporting the SDK's total_cost_usd as a charge would be a lie.
    },
  };
}
