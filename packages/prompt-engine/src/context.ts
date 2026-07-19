import type { Message, MessageImage, Summary, Branch } from "@squirl/shared";
import type { Store } from "@squirl/database";
import type { GlobalMemory } from "@squirl/database";
import type { MetaGraph } from "@squirl/graph-engine";
import { estimateTokens, getContextLimit } from "@squirl/tokenizer";
import { retrieveFromGraph } from "@squirl/context-engine";
import { runSummarizeAncestry, runSummarizeMiddle } from "./summarizer.js";

export interface ContextPayload {
  messages: Array<{ role: string; content: string; images?: MessageImage[] }>;
  systemContext: string;
  tierAncestry: number;
  tierWarm: number;
  tierRetrieved: number;
  tierHot: number;
  /** Tokens of the <selected_artifacts> block plus native-document estimates
   * (0 when none attached) — lets the context inspector project "what if I
   * change the selection". */
  artifactTokens: number;
  tokenEstimate: number;
  /** Selected PDFs to attach natively (as provider document blocks) instead
   * of as extracted text — only populated when the caller says the model
   * accepts PDF input. The caller reads each blob and builds the blocks. */
  nativeDocuments: Array<{ id: string; title: string; blobPath: string; mime: string }>;
}

// Rough per-image token cost — vision providers price an image around this;
// enough for the context meter to move when an image is attached.
const IMAGE_TOKEN_ESTIMATE = 1200;

function countMessagesTokens(messages: Array<{ role: string; content: string; images?: MessageImage[] }>): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + (m.images?.length ?? 0) * IMAGE_TOKEN_ESTIMATE,
    0,
  );
}

const MAX_ANCESTRY_DEPTH = 30;

export function getAncestryMessages(branch: Branch, store: Store): Message[] {
  // Iterative traversal with depth cap to prevent stack overflow
  const chain: Array<{ branch: Branch; messages: Message[] }> = [];
  let current: Branch | undefined = branch;
  let depth = 0;

  while (current?.parentId && depth < MAX_ANCESTRY_DEPTH) {
    const parent = store.getBranch(current.parentId);
    if (!parent) break;
    const parentMsgs = store.getMessages(parent.id);
    const inherited = current.forkAtIndex !== undefined
      ? parentMsgs.slice(0, current.forkAtIndex + 1)
      : parentMsgs;
    chain.unshift({ branch: parent, messages: inherited });
    current = parent;
    depth++;
  }

  // Flatten all inherited messages in order
  const result: Message[] = [];
  for (const entry of chain) {
    result.push(...entry.messages);
  }
  return result;
}

export async function inlineAncestrySummary(
  messages: Message[],
  parentSummaries: Summary[],
  model: string,
): Promise<string> {
  const parts: string[] = [];

  if (parentSummaries.length) {
    for (const s of parentSummaries) {
      parts.push(`[Summary of turns ${s.fromTurn}-${s.toTurn}]\n${s.content}`);
    }
  }

  const summarizedCount = parentSummaries.reduce((sum, s) => sum + (s.toTurn - s.fromTurn + 1), 0);
  const unsummarized = messages.slice(summarizedCount);

  const hotWindow = 10;
  if (unsummarized.length > hotWindow) {
    const compressed = unsummarized.slice(0, -hotWindow);
    const compressedText = await runSummarizeMiddle(compressed, model);
    if (compressedText) {
      parts.push(`[Compressed middle - turns ${compressed[0]!.turn}-${compressed[compressed.length - 1]!.turn}]\n${compressedText}`);
    }
    const recent = unsummarized.slice(-hotWindow);
    for (const m of recent) {
      const prefix = m.role === "user" ? "User" : "Assistant";
      parts.push(`${prefix} (turn ${m.turn}): ${m.content}`);
    }
  } else {
    for (const m of unsummarized) {
      const prefix = m.role === "user" ? "User" : "Assistant";
      parts.push(`${prefix} (turn ${m.turn}): ${m.content}`);
    }
  }

  const result = parts.join("\n\n");
  const budget = 3000;
  if (estimateTokens(result) > budget) {
    return runSummarizeAncestry(messages, model);
  }
  return result;
}

/**
 * Reattach a turn's tool activity to the assistant text the model sees in the
 * hot window. The transcript stores tool calls OUTSIDE message content (the
 * UI renders them separately), so without this the model has no memory of its
 * own actions on later turns — "what commands did you run?" got "I didn't run
 * any". Previews are capped at persist time; the line count is capped here.
 */
const TOOL_TRAIL_MAX_CALLS = 12;
function withToolTrail(m: Message): string {
  if (m.role !== "assistant" || !m.toolCalls?.length) return m.content;
  const shown = m.toolCalls.slice(0, TOOL_TRAIL_MAX_CALLS);
  const lines = shown.map((tc) => {
    const args = tc.argsPreview ? `(${tc.argsPreview})` : "";
    const out = tc.resultPreview ? ` → ${tc.resultPreview}` : "";
    return `- ${tc.name}${args} ${tc.success ? "✓" : "✗ failed"}${out}`;
  });
  const more = m.toolCalls.length > shown.length ? `\n- …and ${m.toolCalls.length - shown.length} more calls` : "";
  return `${m.content}\n\n[Tool calls you made during this turn (abbreviated):\n${lines.join("\n")}${more}]`;
}

export async function buildPayload(
  store: Store,
  branch: Branch,
  graph?: MetaGraph,
  globalMem?: GlobalMemory,
  currentQuery?: string,
  opts?: {
    /** The model accepts PDFs natively — selected PDF artifacts with a
     * preserved blob ride as document blocks instead of extracted text. */
    nativePdf?: boolean;
  },
): Promise<ContextPayload> {
  const messages = store.getMessages(branch.id);
  const summaries = store.getSummaries(branch.id);
  const contextLimit = getContextLimit(branch.model);

  let tierAncestry = 0;
  let tierRetrieved = 0;

  const systemContextBlocks: string[] = [];

  if (globalMem) {
    const projectId = branch.chatId ? store.getChat(branch.chatId)?.projectId : undefined;
    // Branch ancestry (this branch + all parents) makes memory supersession
    // branch-aware: a fact superseded on a sibling fork stays current here.
    const ancestry = new Set<string>();
    for (let b: typeof branch | undefined = branch; b; b = b.parentId ? store.getBranch(b.parentId) : undefined) {
      if (ancestry.has(b.id)) break; // guard against a cyclic parent chain
      ancestry.add(b.id);
    }
    const memBlock = globalMem.asContextBlock(branch.id, branch.chatId, projectId, ancestry);
    if (memBlock) {
      systemContextBlocks.push(`<global_memory>\nDurable facts saved about the user, grouped by scope (global → project → chat → branch; narrower scopes are more specific). Treat them as true unless the user says otherwise.\n${memBlock}\n</global_memory>`);
    }
  }

  const ancestryMsgs = getAncestryMessages(branch, store);
  if (ancestryMsgs.length) {
    let parentSummaries: Summary[] = [];
    if (branch.parentId) {
      parentSummaries = store.getSummaries(branch.parentId);
    }
    const summaryText = await inlineAncestrySummary(ancestryMsgs, parentSummaries, branch.model);
    systemContextBlocks.push(`<ancestry>\nThis branch was forked from a parent conversation. This is what happened before the fork — treat it as real prior conversation with this user.\n${summaryText}\n</ancestry>`);
    tierAncestry = ancestryMsgs.length;
  }

  if (summaries.length) {
    const summariesText = summaries
      .map(s => `[Turns ${s.fromTurn}-${s.toTurn}]:\n${s.content}`)
      .join("\n\n");
    systemContextBlocks.push(`<conversation_summaries>\nOlder turns of THIS conversation, compacted to save space; the recent turns follow verbatim in the message history.\n${summariesText}\n</conversation_summaries>`);
  }

  let retrievedBlocks: string[] = [];
  if (graph && currentQuery && graph.size > 0) {
    retrievedBlocks = await retrieveFromGraph(currentQuery, graph, 3, 0.4, branch.id);
    if (retrievedBlocks.length) {
      const contextText = retrievedBlocks.map(b => `• ${b}`).join("\n");
      systemContextBlocks.push(`<retrieved_context>\nEntries retrieved from this project's knowledge graph because they MAY relate to the current message — judge relevance before relying on them.\n${contextText}\n</retrieved_context>`);
      tierRetrieved = retrievedBlocks.length;
    }
  }

  if (branch.pins.length) {
    const pinBlock = branch.pins.map((p, i) => `${i + 1}. ${p}`).join("\n");
    systemContextBlocks.push(`<pinned_rules>\nThe user pinned these instructions to this branch. They are BINDING — follow them even over your general defaults.\n${pinBlock}\n</pinned_rules>`);
  }

  // Documents the user explicitly attached to this branch (the right panel's
  // artifact checkboxes). Explicit user intent: the token-pressure fallbacks
  // below drop summaries and ancestry but deliberately never touch this
  // block. Oversized artifacts truncate with a visible marker instead of
  // silently blowing the budget.
  let artifactTokens = 0;
  let nativeDocTokens = 0;
  const nativeDocuments: ContextPayload["nativeDocuments"] = [];
  // Providers cap request size (Anthropic ~32MB) — native PDFs past this
  // budget fall back to the extracted-text path below instead of 400ing.
  let nativeDocBudget = 24 * 1024 * 1024;
  if (branch.selectedArtifacts?.length) {
    const ARTIFACT_TOKEN_CAP = 8000;
    const parts: string[] = [];
    for (const artifactId of branch.selectedArtifacts) {
      const artifact = store.getArtifact(artifactId);
      if (!artifact) continue; // deleted since it was selected
      if (
        opts?.nativePdf &&
        artifact.mime === "application/pdf" &&
        artifact.blobPath &&
        (artifact.byteSize ?? Infinity) <= nativeDocBudget
      ) {
        nativeDocBudget -= artifact.byteSize;
        nativeDocuments.push({ id: artifact.id, title: artifact.title, blobPath: artifact.blobPath, mime: artifact.mime });
        // Very rough: ~50KB and ~2250 tokens per PDF page. Only feeds the
        // context meter; providers do the real accounting server-side.
        nativeDocTokens += Math.min(120_000, Math.max(1500, Math.round(artifact.byteSize / 50_000) * 2250));
        continue;
      }
      let content: string = artifact.content;
      // This runs every turn, so don't tokenize huge documents just to decide
      // to truncate them: at or under the cap in characters a text can't
      // exceed it in tokens (a token is at least one character), and far
      // above it the exact count doesn't change the outcome. Only the band
      // between needs a real count.
      const needsCount = content.length > ARTIFACT_TOKEN_CAP && content.length <= ARTIFACT_TOKEN_CAP * 8;
      if (content.length > ARTIFACT_TOKEN_CAP * 8 || (needsCount && estimateTokens(content) > ARTIFACT_TOKEN_CAP)) {
        content = content.slice(0, ARTIFACT_TOKEN_CAP * 4) +
          `\n[truncated — "${artifact.title}" continues beyond this excerpt]`;
      }
      parts.push(`## ${artifact.title}\n${content}`);
    }
    if (parts.length) {
      const block = `<selected_artifacts>\nDocuments the user explicitly attached to this branch's context — treat them as authoritative source material for this conversation.\n${parts.join("\n\n")}\n</selected_artifacts>`;
      systemContextBlocks.push(block);
      artifactTokens = estimateTokens(block);
    }
    artifactTokens += nativeDocTokens;
  }

  // startTurn is a TURN NUMBER, not an array index — turn numbers only match
  // array position when no message has ever been deleted from this branch.
  // Deleting/editing/retrying a message (any of which can remove a turn from
  // the middle of the sequence, not just the tail) leaves gaps, so filtering
  // by the actual `turn` field is required; slicing by position could cut
  // away the current message entirely and send an empty `messages` array —
  // which providers that always prepend their own system message tolerate,
  // but Codex's bare `input` field rejects outright with a 400.
  const startTurn = summaries.length ? Math.max(...summaries.map(s => s.toTurn)) + 1 : 0;
  const hot = messages.filter(m => m.turn >= startTurn);
  const apiMessages = hot.map(m => ({ role: m.role, content: withToolTrail(m), images: m.images }));

  let systemContext = "";
  if (systemContextBlocks.length) {
    systemContext = `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}`;
  }

  let total = estimateTokens(systemContext) + countMessagesTokens(apiMessages) + nativeDocTokens;

  if (total > contextLimit) {
    const sIdx = systemContextBlocks.findIndex(b => b.startsWith("<conversation_summaries>"));
    if (sIdx !== -1) {
      systemContextBlocks.splice(sIdx, 1);
      systemContext = systemContextBlocks.length ? `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}` : "";
      total = estimateTokens(systemContext) + countMessagesTokens(apiMessages) + nativeDocTokens;
    }
  }

  if (total > contextLimit) {
    const aIdx = systemContextBlocks.findIndex(b => b.startsWith("<ancestry>"));
    if (aIdx !== -1) {
      systemContextBlocks.splice(aIdx, 1);
      systemContext = systemContextBlocks.length ? `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}` : "";
      total = estimateTokens(systemContext) + countMessagesTokens(apiMessages) + nativeDocTokens;
    }
  }

  while (total > contextLimit && apiMessages.length > 1) {
    apiMessages.shift();
    total = estimateTokens(systemContext) + countMessagesTokens(apiMessages) + nativeDocTokens;
  }

  return {
    messages: apiMessages,
    systemContext,
    tierAncestry,
    tierWarm: summaries.length,
    tierRetrieved,
    tierHot: hot.length,
    artifactTokens,
    tokenEstimate: total,
    nativeDocuments,
  };
}
