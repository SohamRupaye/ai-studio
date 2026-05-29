import type { Message, Summary, Branch } from "@ai-studio/shared";
import type { Store } from "@ai-studio/database";
import type { GlobalMemory } from "@ai-studio/database";
import type { MetaGraph } from "@ai-studio/graph-engine";
import { estimateTokens, getContextLimit } from "@ai-studio/tokenizer";
import { retrieveFromGraph } from "@ai-studio/context-engine";
import { runSummarizeAncestry, runSummarizeMiddle } from "./summarizer.js";

export interface ContextPayload {
  messages: Array<{ role: string; content: string }>;
  systemContext: string;
  tierAncestry: number;
  tierWarm: number;
  tierRetrieved: number;
  tierHot: number;
  tokenEstimate: number;
}

function countMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
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

export async function buildPayload(
  store: Store,
  branch: Branch,
  graph?: MetaGraph,
  globalMem?: GlobalMemory,
  currentQuery?: string,
): Promise<ContextPayload> {
  const messages = store.getMessages(branch.id);
  const summaries = store.getSummaries(branch.id);
  const contextLimit = getContextLimit(branch.model);

  let tierAncestry = 0;
  let tierRetrieved = 0;

  const systemContextBlocks: string[] = [];

  if (globalMem) {
    const memBlock = globalMem.asContextBlock(branch.id, branch.chatId);
    if (memBlock) {
      systemContextBlocks.push(`<global_memory>\n${memBlock}\n</global_memory>`);
    }
  }

  const ancestryMsgs = getAncestryMessages(branch, store);
  if (ancestryMsgs.length) {
    let parentSummaries: Summary[] = [];
    if (branch.parentId) {
      parentSummaries = store.getSummaries(branch.parentId);
    }
    const summaryText = await inlineAncestrySummary(ancestryMsgs, parentSummaries, branch.model);
    systemContextBlocks.push(`<ancestry>\n${summaryText}\n</ancestry>`);
    tierAncestry = ancestryMsgs.length;
  }

  if (summaries.length) {
    const summariesText = summaries
      .map(s => `[Turns ${s.fromTurn}-${s.toTurn}]:\n${s.content}`)
      .join("\n\n");
    systemContextBlocks.push(`<conversation_summaries>\n${summariesText}\n</conversation_summaries>`);
  }

  let retrievedBlocks: string[] = [];
  if (graph && currentQuery && graph.size > 0) {
    retrievedBlocks = await retrieveFromGraph(currentQuery, graph, 3, 0.4, branch.id);
    if (retrievedBlocks.length) {
      const contextText = retrievedBlocks.map(b => `• ${b}`).join("\n");
      systemContextBlocks.push(`<retrieved_context>\n${contextText}\n</retrieved_context>`);
      tierRetrieved = retrievedBlocks.length;
    }
  }

  if (branch.pins.length) {
    const pinBlock = branch.pins.map((p, i) => `${i + 1}. ${p}`).join("\n");
    systemContextBlocks.push(`<pinned_rules>\n${pinBlock}\n</pinned_rules>`);
  }

  const startIdx = summaries.length ? Math.max(...summaries.map(s => s.toTurn)) + 1 : 0;
  const hot = messages.slice(startIdx);
  const apiMessages = hot.map(m => ({ role: m.role, content: m.content }));

  let systemContext = "";
  if (systemContextBlocks.length) {
    systemContext = `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}`;
  }

  let total = estimateTokens(systemContext) + countMessagesTokens(apiMessages);

  if (total > contextLimit) {
    const sIdx = systemContextBlocks.findIndex(b => b.startsWith("<conversation_summaries>"));
    if (sIdx !== -1) {
      systemContextBlocks.splice(sIdx, 1);
      systemContext = systemContextBlocks.length ? `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}` : "";
      total = estimateTokens(systemContext) + countMessagesTokens(apiMessages);
    }
  }

  if (total > contextLimit) {
    const aIdx = systemContextBlocks.findIndex(b => b.startsWith("<ancestry>"));
    if (aIdx !== -1) {
      systemContextBlocks.splice(aIdx, 1);
      systemContext = systemContextBlocks.length ? `[WORKSPACE CONTEXT]\nThe following is the active context for this branching session:\n\n${systemContextBlocks.join("\n\n")}` : "";
      total = estimateTokens(systemContext) + countMessagesTokens(apiMessages);
    }
  }

  while (total > contextLimit && apiMessages.length > 1) {
    apiMessages.shift();
    total = estimateTokens(systemContext) + countMessagesTokens(apiMessages);
  }

  return {
    messages: apiMessages,
    systemContext,
    tierAncestry,
    tierWarm: summaries.length,
    tierRetrieved,
    tierHot: hot.length,
    tokenEstimate: total,
  };
}
