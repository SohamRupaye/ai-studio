import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { Router, getConfig, ProviderRateLimitError } from "@squirl/providers";
import type { ContentBlock } from "@squirl/providers";
import { Agent, createRuntime, classifyAndIndex, extractAndPersistArtifacts, runAgentCooperative } from "@squirl/ai-core";
import { buildPayload, runPendingSummaries, shouldSummarize } from "@squirl/prompt-engine";
import { getContextLimit, supportsPdfInput, supportsVision } from "@squirl/tokenizer";
import type { MessageToolCall, SubagentRunRecord } from "@squirl/shared";
import { toolCallSummary, toolCallArgsDetail, toolCallResultDetail, clipText } from "@squirl/shared";
import { applySubagentEvent, newSubagentRecord } from "@squirl/shared";
import type { ContextStats } from "@squirl/event-bus";
import type { SkillInfo } from "@squirl/tools-runtime";
import { handle } from "./handle.js";
import {
  mainWindow, store, router, graph, globalMem, registry, costTracker, personas, skills,
  nodeCounter, dataDirPath, currentProjectId, setCurrentProjectId, memoryScope, routerFor,
} from "../state.js";
import { cancelPendingApprovals, finishApproval, setApprovalTurnBranch } from "../approvals.js";

/** AbortController tagged with why it was aborted, so a superseded request
 * can tell the renderer (an explicit user Stop already handles its own UI). */
type ExtendedAbortController = AbortController & { supersededByNewMessage?: boolean };

let abortController: ExtendedAbortController | null = null;
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

// ── Summarization ─────────────────────────────────────────────────────────────

function scheduleSummarization(branchId: string) {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(async () => {
    summaryTimer = null;
    if (shouldSummarize(store, branchId)) {
      await runPendingSummaries(store, router, branchId);
    }
  }, 5000);
}

export function registerChatHandlers() {
  // ── Chat ────────────────────────────────────────────────────────────────────

  handle("chat:send", async ({ branchId, message, images }) => {
    if (!mainWindow) return;
    // If a prior request is still in flight, it's being superseded by this
    // new message (not a user-initiated Stop) — tag the OLD controller so
    // its own loop (holding a reference to it) knows to notify the renderer
    // instead of hanging silently forever.
    if (abortController && !abortController.signal.aborted) {
      abortController.supersededByNewMessage = true;
      abortController.abort();
    }
    // A superseded turn's pending approval card must not outlive it.
    cancelPendingApprovals();
    const myController: ExtendedAbortController = new AbortController();
    abortController = myController;
    const signal = myController.signal;

    const branch = store.getBranch(branchId);
    if (!branch) {
      mainWindow.webContents.send("chat:stream", { type: "error", branchId, message: `Branch ${branchId} not found`, turn: store.getMessageCount(branchId) - 1 });
      return;
    }
    const cfg = getConfig();
    const model = branch.model || cfg.defaultModel;

    // Slash-invoked skill: "/name rest of message". Only a leading token that
    // matches an INSTALLED skill counts as an invocation — anything else
    // ("/etc/hosts is broken") passes through as a normal message. Both the
    // composer's autocomplete and a hand-typed command converge here.
    let invokedSkill: SkillInfo | undefined;
    const slash = message.match(/^\/([A-Za-z0-9][\w-]*)/);
    if (slash) {
      const candidate = skills.get(slash[1]!);
      if (candidate) {
        if (cfg.disabledSkills.includes(candidate.name)) {
          // Nothing persisted yet, so turn -1 (same convention as the vision gate).
          mainWindow.webContents.send("chat:stream", {
            type: "error",
            branchId,
            message: `The skill "/${candidate.name}" is disabled. Enable it in Settings → Skills, then resend.`,
            turn: -1,
          });
          return;
        }
        invokedSkill = candidate;
      }
    }

    // Capability gate (honest block): don't silently drop an attached image on
    // a text-only model. Refuse before persisting so the user can switch model
    // and resend — never a half-committed turn.
    if (images?.length && !supportsVision(model)) {
      mainWindow.webContents.send("chat:stream", {
        type: "error",
        branchId,
        message: `${model} can't view images. Switch to a vision-capable model, then resend.`,
        // Nothing was persisted, so there is no turn to point at — -1 routes
        // the renderer's Retry down the plain-resend path (no edit).
        turn: -1,
      });
      return;
    }

    store.addMessage(branchId, "user", message, undefined, undefined, images);
    // Turn number of the user message this invocation is answering — threaded
    // through every error event below so the renderer can mark specifically
    // THIS message (not whichever one is currently last) as failed.
    const userTurn = store.getMessageCount(branchId) - 1;

    // Track the project this branch belongs to, for scoping memories.
    setCurrentProjectId(branch.chatId ? (store.getChat(branch.chatId)?.projectId ?? "") : "");

    const payload = await buildPayload(store, branch, graph, globalMem, message, {
      nativePdf: supportsPdfInput(model),
    });

    // Capture what the model sees this turn for the right panel's context
    // inspector. Persisted (survives restarts) and captured here as a side
    // effect — deliberately never recomputed on demand, since a payload
    // dry-run can spend tokens (ancestry compression, embeddings).
    const contextStats: ContextStats = {
      model,
      tokenEstimate: payload.tokenEstimate,
      contextLimit: getContextLimit(model),
      tierAncestry: payload.tierAncestry,
      tierWarm: payload.tierWarm,
      tierRetrieved: payload.tierRetrieved,
      tierHot: payload.tierHot,
      artifactTokens: payload.artifactTokens,
      capturedAt: Date.now(),
    };
    store.setMeta(`ctxstats:${branchId}`, JSON.stringify(contextStats));
    // Org-level API keys override the globals: this chat runs on its org's router.
    const chatRouter = routerFor(
      currentProjectId ? store.getProject(currentProjectId)?.orgId : undefined,
    );
    // Per-agent lifecycle for this turn's subagent/delegate calls: forwarded
    // to the renderer live and persisted with the assistant message on done.
    // Runs group by runId in first-seen order, matched to subagent/delegate
    // tool calls in invocation order at persist time. The trail itself is
    // built by the same shared reducer the renderer uses (applySubagentEvent)
    // so the live drawer and the persisted record can't drift.
    const subagentRunOrder: string[] = [];
    const subagentRuns = new Map<string, Map<string, SubagentRunRecord>>();
    const subagentStartedAt = new Map<string, number>();
    createRuntime(chatRouter, registry, model, (ev) => {
      let group = subagentRuns.get(ev.runId);
      if (!group) { group = new Map(); subagentRuns.set(ev.runId, group); subagentRunOrder.push(ev.runId); }
      let rec = group.get(ev.agentId);
      if (!rec) { rec = newSubagentRecord(ev.agentId); group.set(ev.agentId, rec); }
      applySubagentEvent(rec, ev);
      const key = `${ev.runId}:${ev.agentId}`;
      if (ev.status === "start" && !subagentStartedAt.has(key)) subagentStartedAt.set(key, Date.now());
      if (ev.status === "done" || ev.status === "failed") {
        const started = subagentStartedAt.get(key);
        if (started) rec.durationMs = Date.now() - started;
        if (rec.result && rec.result.length > 16_000) rec.result = `${rec.result.slice(0, 16_000)}\n…[truncated]`;
      }
      mainWindow?.webContents.send("chat:stream", { type: "subagent", branchId, ...ev });
    });

    // Active persona for this branch (if any) layers its own system prompt
    // ahead of the base instructions and restricts which tools it can see.
    const activePersonaName = store.getMeta(`persona:${branchId}`) || "default";
    const persona = personas.get(activePersonaName);

    // Project-level custom instructions (set in project settings) sit between
    // the app boilerplate and the per-conversation context.
    const projectPrompt = (currentProjectId ? store.getProject(currentProjectId)?.systemPrompt : undefined)?.trim();
    const baseSystem = buildBaseSystem(projectPrompt, payload.systemContext);
    let system = persona && persona.name !== "default"
      ? `${persona.systemPrompt}\n\n${baseSystem}`
      : baseSystem;
    // A slash-invoked skill binds this turn: its full body rides the system
    // prompt (the persisted user message keeps the raw "/name …" text, so the
    // transcript shows what was typed and forks inherit the invocation).
    if (invokedSkill) {
      system += `\n\n<invoked_skill name="${invokedSkill.name}">\nThe user invoked this skill for this request — its instructions are binding for this turn.\n${invokedSkill.content}\n(Supporting files for this skill live in ${dirname(invokedSkill.location)} — resolve relative paths against that directory.)\n</invoked_skill>`;
    }
    // sessionId scopes snapshot tracking (write_file/edit_file/patch) to this branch.
    const agent = new Agent(chatRouter, registry, { sessionId: branchId });

    // Resolve image refs on hot-window messages into content the model gets.
    // Vision models receive native image blocks (base64 read from the blob);
    // this is only reached when the model supports vision (the current turn is
    // gated above, and historical images degrade to a text note for safety).
    const vision = supportsVision(model);
    const agentMessages = payload.messages.map(m => {
      if (!m.images?.length) return { role: m.role, content: m.content };
      if (!vision) {
        const names = m.images.map(im => im.filename).join(", ");
        return { role: m.role, content: `${m.content}\n\n[Attached image(s): ${names} — the current model can't view images.]` };
      }
      const blocks: ContentBlock[] = m.content ? [{ type: "text", text: m.content }] : [];
      for (const im of m.images) {
        try {
          const data = readFileSync(join(dataDirPath, im.blobPath)).toString("base64");
          blocks.push({ type: "image", mediaType: im.mediaType, data });
        } catch {
          // Blob missing (swept or lost) — keep the turn, but tell the model
          // an image was here rather than silently narrowing what it sees.
          blocks.push({ type: "text", text: `\n[Attached image "${im.filename}" is no longer available.]` });
        }
      }
      return { role: m.role, content: blocks };
    });

    // Selected PDFs the model reads natively ride the current turn as
    // document blocks (before the text, per provider guidance). Re-attached
    // each send while selected — same lifetime as the extracted-text path
    // they replace. A missing blob degrades to a visible note.
    if (payload.nativeDocuments.length && agentMessages.length) {
      const last = agentMessages[agentMessages.length - 1]!;
      if (last.role === "user") {
        const docBlocks: ContentBlock[] = [];
        for (const doc of payload.nativeDocuments) {
          try {
            const data = readFileSync(join(dataDirPath, doc.blobPath)).toString("base64");
            docBlocks.push({ type: "document", mediaType: doc.mime, data, title: doc.title });
          } catch {
            docBlocks.push({ type: "text", text: `[Attached document "${doc.title}" is no longer available.]\n` });
          }
        }
        const existing: ContentBlock[] = typeof last.content === "string"
          ? (last.content ? [{ type: "text", text: last.content }] : [])
          : last.content;
        last.content = [...docBlocks, ...existing];
      }
    }

    // Approval cards raised by subagents (sessionId "sub") route to this turn's branch.
    setApprovalTurnBranch(branchId);
    try {
      for await (const event of runAgentCooperative(agent, model, agentMessages, system, signal)) {
        if (signal.aborted) {
          // Only notify the renderer if this request was superseded by a
          // newer message — an explicit user Stop already cleans up its own
          // UI client-side and doesn't need (or want) an error toast here.
          if (myController.supersededByNewMessage) {
            mainWindow?.webContents.send("chat:stream", { type: "error", branchId, message: "Cancelled — a newer message was sent.", turn: userTurn });
          }
          break;
        }
        if (event.type === "text" || event.type === "thinking" || event.type === "tool_start" || event.type === "tool_end" || event.type === "tool_call_streaming") {
          mainWindow?.webContents.send("chat:stream", { ...event, branchId });
        } else if (event.type === "done") {
          if (!event.result.text && !event.result.toolCalls.length) {
            mainWindow?.webContents.send("chat:stream", {
              type: "error",
              branchId,
              message: `${model} returned an empty response. This can happen with free-tier models under load — try again or switch models.`,
              turn: userTurn,
            });
            break;
          }
          const assistantText = event.result.text;
          // Attach each subagent/delegate call's per-agent detail (background
          // delegate jobs still running persist as "running" — live status
          // keeps streaming, and delegate_result stays the model-facing check).
          let runIdx = 0;
          const persistedToolCalls = event.result.toolCalls.map((tc) => {
            // Previews persist with the call so the UI can answer "what
            // command ran" and prompt assembly can remind the model of its
            // own actions on later turns (see withToolTrail in prompt-engine).
            const base: MessageToolCall = {
              name: tc.name,
              success: tc.success,
              argsPreview: toolCallPreview(tc.args, 300),
              resultPreview: toolCallPreview(tc.result, 200),
              // User-facing detail: the salient one-liner the row leads with
              // plus the full (capped) args/result for the expandable panel.
              summary: toolCallSummary(tc.name, tc.args),
              args: toolCallArgsDetail(tc.name, tc.args),
              result: toolCallResultDetail(tc.result),
            };
            if ((tc.name === "subagent" || tc.name === "delegate") && runIdx < subagentRunOrder.length) {
              const group = subagentRuns.get(subagentRunOrder[runIdx++]!);
              if (group?.size) base.agents = [...group.values()];
            }
            return base;
          });
          store.addMessage(
            branchId, "assistant", assistantText, model, persistedToolCalls, undefined,
            event.result.thinking ? clipText(event.result.thinking, 24_000) : undefined,
          );

          // Cost tracking
          costTracker.record(model, { input_tokens: payload.tokenEstimate, output_tokens: assistantText.length / 4 });
          const lastEntry = costTracker.lastCost();
          const [inRate, outRate] = getCostRate(model);
          const estOut = Math.ceil(assistantText.length / 4);
          const costUsd = (payload.tokenEstimate * inRate + estOut * outRate) / 1_000_000;
          store.recordCost(branchId, model, payload.tokenEstimate, estOut, costUsd);

          mainWindow?.webContents.send("chat:stream", {
            type: "done", branchId, text: assistantText, iterations: event.result.iterations, cost: lastEntry,
          });

          // Classify + index
          const turnNum = store.getMessageCount(branchId) - 1;
          classifyAndIndex(router, graph, nodeCounter, message, assistantText, branchId, turnNum);

          // Deterministic memory capture — guarantees an explicit "remember X"
          // request is persisted even if the model didn't call the remember tool.
          try {
            const calledRemember =
              Array.isArray((event.result as any).toolCalls) &&
              (event.result as any).toolCalls.some((tc: any) => tc.name === "remember");
            if (!calledRemember) {
              const fact = extractMemoryFact(message);
              if (fact) globalMem.add(fact, memoryScope());
            }
          } catch { /* non-fatal */ }

          // Auto-extract artifacts
          if (branch.chatId) {
            const chat = store.getChat(branch.chatId);
            if (chat) {
              extractAndPersistArtifacts(store, assistantText, branchId, chat.projectId);
            }
          }

          scheduleSummarization(branchId);

          // Auto-title: a chat created without a name titles itself off this
          // exchange. Fire-and-forget — a failure just leaves the flag set,
          // so the next completed turn retries.
          autoTitleChat(branch.chatId, branchId, assistantText, chatRouter, model)
            .catch((e) => console.error("[auto-title]", e?.message ?? e));
        }
      }
    } catch (err: any) {
      if (!signal.aborted) {
        mainWindow?.webContents.send("chat:stream", {
          type: "error",
          branchId,
          message: err.message,
          turn: userTurn,
          rateLimited: err instanceof ProviderRateLimitError,
          retryAfterSeconds: err instanceof ProviderRateLimitError ? err.retryAfterSeconds : undefined,
        });
      }
    } finally {
      setApprovalTurnBranch(null);
    }
  });

  handle("chat:abort", () => {
    abortController?.abort();
    abortController = null;
    // Deny anything still waiting on the card — the turn it belongs to is gone.
    cancelPendingApprovals();
  });

  handle("chat:approval-decision", ({ id, allowed, always }) => {
    finishApproval(id, { allowed, always });
  });
}

// ── System prompt ─────────────────────────────────────────────────────────────

const PLATFORM_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/**
 * The app-level system prompt, rebuilt each turn so the date is always
 * current. Deliberately compact: it runs on every model of every provider
 * (the default is a small one), and small models follow short prompts best —
 * resist growing this into an epic. Layering (outermost first): persona
 * prompt (if any) → this → project instructions → workspace context blocks
 * (assembled in prompt-engine's buildPayload, semantics explained per block).
 */
function buildBaseSystem(projectPrompt?: string, systemContext?: string): string {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const platform = PLATFORM_NAMES[process.platform] ?? process.platform;
  const userName = store.getMeta("user_name");

  const parts: string[] = [];

  parts.push(
    `You are the assistant inside AI Studio, a desktop AI workspace where conversations work like git: chats fork into branches, and durable context (memories, artifacts, pinned rules) accumulates per project so the user never has to re-explain themselves. You are talking to ${userName || "the user"} on one branch of that workspace.`,
  );

  parts.push(
    `ENVIRONMENT
- Today is ${date}. Trust this over your training data for anything date-sensitive, and mind the year when judging what is past vs. future.
- Host machine: ${platform}. Target it when suggesting or running shell commands.`,
  );

  parts.push(
    `HOW TO ACT
- When the user asks for something your tools can do, do it now — don't ask permission first and don't say you'll do it later. If a request is ambiguous in a way that changes what you'd do, either state your assumption and proceed or ask ONE focused question; never reply with only questions when a useful answer is possible.
- Never claim an action you didn't take (a file edit, a saved memory, a search). A claim of work requires the matching tool call.
- If the same tool call fails twice, stop repeating it — say what's failing and try a different approach.`,
  );

  parts.push(
    `MEMORY
- Call \`remember\` when the user explicitly asks you to remember/save/note something, or states a clearly durable fact about themselves (stable preferences, standing constraints, personal details). Phrase the fact as a standalone statement.
- Do NOT store transient task context — the current task's details live in the conversation. If unsure whether a fact is already saved, check with \`recall_memories\` instead of saving a duplicate.
- Memory is housekeeping, never the deliverable: answer the user's actual request first and mention a save in at most one short closing sentence.`,
  );

  parts.push(
    `RESPONSES
- Lead with the answer, then supporting detail. Be concrete and concise; skip filler, hedging, and restating the question.
- Your replies render as full markdown: use tables for comparisons and structured data, fenced code blocks with a language tag for code, and headings only in long multi-section answers.
- Match the user's language and technical depth.`,
  );

  // Enabled skills are advertised by name + description only; the `skill`
  // tool fetches a body on demand. Skills without a description aren't
  // advertised (nothing to match a task against), and slash-only skills
  // (disable-model-invocation) never are — format() applies both filters.
  const enabledSkills = skills.all({ deny: getConfig().disabledSkills }).filter((s) => s.description && !s.userOnly);
  if (enabledSkills.length) {
    parts.push(
      `SKILLS — reusable instruction packages. When a task matches a skill's description below, call the \`skill\` tool with its name FIRST and follow the returned instructions. The user can also invoke one directly by starting a message with /<name>.\n${skills.format({ deny: getConfig().disabledSkills }, true)}`,
    );
  }

  if (projectPrompt) parts.push(`PROJECT INSTRUCTIONS (set by the user for this project — follow them):\n${projectPrompt}`);
  if (systemContext) parts.push(systemContext);

  return parts.join("\n\n");
}

// ── Chat auto-titling ─────────────────────────────────────────────────────────

const TITLE_SYSTEM = `You generate a title for a chat conversation from its first exchange. Rules:
• 2-6 words capturing the topic or task
• Sentence case (capitalize only the first word and proper nouns)
• No quotes, no trailing punctuation, no emoji
• Plain description, not a summary sentence ("Tokyo trip planning", not "The user is planning a trip")
Output ONLY the title, nothing else.`;

/**
 * Title a still-unnamed chat ("New chat", created without a user-typed name)
 * from its first user message + the reply that just finished. Any rename —
 * this one or a user's — clears the flag, so it runs at most once per chat;
 * on failure the flag survives and the next completed turn retries.
 */
async function autoTitleChat(
  chatId: string | undefined,
  branchId: string,
  assistantText: string,
  chatRouter: Router,
  model: string,
): Promise<void> {
  if (!chatId) return;
  const chat = store.getChat(chatId);
  if (!chat?.autoName) return;

  const firstUserMessage = store.getMessages(branchId).find((m) => m.role === "user")?.content ?? "";
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  const prompt = `User: ${clip(firstUserMessage, 2000)}\n\nAssistant: ${clip(assistantText, 2000)}`;

  const result = await chatRouter.call(model, [{ role: "user", content: prompt }], TITLE_SYSTEM);
  // Defensive cleanup: first line only, unquoted, no trailing punctuation.
  const title = (result.text ?? "")
    .trim()
    .split("\n")[0]!
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.!?,;:\s]+$/g, "")
    .slice(0, 60)
    .trim();
  if (!title) return;

  // The user may have renamed the chat while the call was in flight — their
  // name wins, so re-check the flag before writing.
  if (!store.getChat(chatId)?.autoName) return;
  store.renameChat(chatId, title);
  mainWindow?.webContents.send("chat:titled", { chatId, name: title });
}

// ── Memory extraction helper ──────────────────────────────────────────────────

/**
 * Extract the fact from an explicit, self-contained "remember X" style
 * request. Returns null when the message isn't a memory-save request, OR
 * when it refers to prior conversation content ("these bits", "that",
 * "the above", "it") that this regex-based extractor cannot resolve — in
 * that case the model's own `remember` tool call is the only reliable path,
 * and saving the literal directive sentence would be worse than saving
 * nothing.
 */
const LEADING_MEMORY_DIRECTIVE =
  /^(please\s+)?(can you\s+|could you\s+|pls\s+)?(add\s+(?:this\s+)?(?:to|in|into)?\s*(?:the\s+)?memory|remember|note|save|store|keep in mind|memori[sz]e|don'?t forget)\b/i;

function extractMemoryFact(message: string): string | null {
  const msg = message.trim();

  // Must OPEN with an explicit save directive. Matching the trigger word
  // anywhere in the message (the previous approach) false-positives on
  // messages that merely mention "remember"/"save"/etc. without asking for
  // anything to be saved — e.g. "I never said to remember anything" would
  // itself get saved as a "fact", verbatim.
  if (!LEADING_MEMORY_DIRECTIVE.test(msg)) return null;

  // Bail out on references to prior context this extractor can't resolve —
  // "save these bits", "remember that [we discussed]" (no clause after
  // "that"), "note the above", "keep it in mind". Extracting the literal
  // sentence in these cases would save the directive itself as the "fact",
  // which is worse than saving nothing — only the model's own `remember`
  // tool call (which has the actual conversation context) can do this right.
  const hasThatClause = /\bthat\s+\S+/i.test(msg);
  const isReferential = /\b(this|these|it|the above|those)\b/i.test(msg) || (/\bthat\b/i.test(msg) && !hasThatClause);
  if (isReferential) return null;

  // Prefer the clause after the LAST "that" (handles "remember that again that X").
  const afterThat = msg.match(/^.*\bthat\b\s+(.+)$/i);
  let fact = afterThat ? afterThat[1] : msg;

  // Otherwise strip a leading directive phrase.
  if (!afterThat) {
    fact = fact.replace(
      /^(please\s+)?(can you\s+|could you\s+|pls\s+)?(add\s+(?:this\s+)?(?:to|in|into)?\s*(?:the\s+)?memory|remember|note|save|store|keep in mind|memori[sz]e)\b[:,\-\s]*/i,
      "",
    );
  }

  fact = fact.replace(/\s+/g, " ").replace(/[?.!,\s]+$/g, "").trim();
  // Guard against empty or non-substantive extractions.
  if (fact.length < 3) return null;
  return fact;
}

// ── Tool-call previews ────────────────────────────────────────────────────────

/**
 * One-line preview of a tool call's args or result for persistence — enough
 * to answer "what did that call do", small enough to ride the hot window on
 * every later turn. Undefined for empty payloads so the JSON stays lean.
 */
function toolCallPreview(value: unknown, cap: number): string | undefined {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || text === "{}") return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

// ── Cost helper ───────────────────────────────────────────────────────────────

function getCostRate(model: string): [number, number] {
  const PRICING: Record<string, [number, number]> = {
    "claude-sonnet": [3, 15], "claude-haiku": [0.25, 1.25], "claude-opus": [15, 75],
    "gpt-4o": [2.5, 10], "gpt-4o-mini": [0.15, 0.6], "gpt-5": [5, 15],
    "o1": [15, 60], "o3": [10, 40], "o4-mini": [1.1, 4.4],
    "gemini-2.0-flash": [0.075, 0.3], "gemini-2.5-pro": [1.25, 10],
  };
  for (const [prefix, rate] of Object.entries(PRICING)) {
    if (model.includes(prefix)) return rate;
  }
  return [1, 3];
}
