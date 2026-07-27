import type { Store } from "@squirl/database";
import { type Router, getConfig, utilityModelFor } from "@squirl/providers";
import type { Message, Summary } from "@squirl/shared";
import { embed, cosineSim } from "@squirl/graph-engine";
import { withToolTrail } from "./trail.js";

/**
 * Summarisation inherits a branch's pinned model, which would silently spend
 * Claude subscription quota on background chores. The subscription is opted in
 * for chat turns only, so subscription ids fall back to the utility model.
 */
function summaryModel(model: string): string {
  return utilityModelFor(model, getConfig().classifierModel);
}

/**
 * Configurable compaction settings - lets users tune when/how context gets compressed
 */
export interface CompactionConfig {
  /** How many messages in the hot window (kept verbatim). Default: 10 */
  hotWindow?: number;
  /** Minimum total messages before compaction triggers. Default: 14 */
  minMessages?: number;
  /** How many unsummarized messages outside hot window before triggering. Default: 4 */
  unsummarizedThreshold?: number;
  /** Max summaries before triggering meta-summary collapse. Default: 5 */
  metaSummaryThreshold?: number;
  /** Whether compaction runs automatically. Default: true */
  auto?: boolean;
}

export const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
  hotWindow: 10,
  minMessages: 14,
  unsummarizedThreshold: 4,
  metaSummaryThreshold: 5,
  auto: true,
};

export const SUMMARY_SYSTEM = `You are a concise conversation summarizer. Summarize the given turns into 4-8 bullet points. Rules:
• Preserve ALL specific names, references, and key terms verbatim
• Preserve exact identifiers from tool calls verbatim (page/document IDs, URLs, file paths) — later turns need them to keep acting on the same objects
• Clearly attribute: 'User decided X' vs 'AI suggested Y'
• Keep decisions, constraints, and trade-offs with their reasoning
• Preserve exact quotes or key details if discussed
• Note open questions or unresolved issues
• Be terse but never drop specifics for brevity
Output only the bullet points, nothing else.`;

export const META_SUMMARY_SYSTEM = `You are summarizing a series of conversation summaries into a single higher-level summary. These summaries span a long conversation history. Produce 5-10 bullet points that capture:
• The overall arc: what was discussed, decided, or explored
• All specific names, references, and key terms
• Key constraints and trade-offs that still apply
• Current state: what's resolved, what's pending
Output only the bullet points.`;

export const ANCESTRY_SUMMARY_SYSTEM = `You are compressing a parent branch's conversation history for a child branch. The child needs to understand what happened before it was forked. Produce a concise summary:
• What was the goal or topic being worked on
• Key decisions and conclusions established
• Important specifics, names, or references mentioned
• The state of things at the point of forking
• Any open questions or next steps that were pending
Be thorough on specifics but concise on prose.`;

async function embedMessages(messages: Message[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const m of messages) {
    embeddings.push(await embed(m.content));
  }
  return embeddings;
}

function extractFilePaths(text: string): string[] {
  const pattern = /(?:^|\s)(?:\.?\/?(?:[\w\-]+\/)+[\w\-]+\.[\w]+|\.\/[\w\-]+\.[\w]+)/g;
  const matches = text.match(pattern);
  return matches ? matches.map(m => m.trim().toLowerCase()) : [];
}

function extractUrls(text: string): string[] {
  const pattern = /https?:\/\/(?:www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;
  const matches = text.match(pattern);
  return matches ? matches.map(m => m.trim().toLowerCase()) : [];
}

function extractNouns(text: string): string[] {
  const pattern = /\b([A-Z][a-zA-Z0-9_\-]+)\b/g;
  const matches = text.match(pattern);
  if (!matches) return [];
  const stopwords = new Set(["the", "a", "an", "i", "we", "you", "he", "she", "they", "it", "this", "that", "there", "here", "to", "in", "on", "at", "for", "with", "and", "but", "or", "so", "if"]);
  return matches.map(m => m.trim()).filter(m => !stopwords.has(m.toLowerCase()));
}

export async function findTopicBoundaries(messages: Message[]): Promise<number[]> {
  const minChunkSize = 4;
  const maxChunkSize = 15;
  const defaultThreshold = 0.45;

  if (messages.length <= minChunkSize) return [];

  const embeddings = await embedMessages(messages);
  const boundaries: number[] = [];
  let lastBoundary = 0;

  for (let i = 1; i < messages.length; i++) {
    const chunkSize = i - lastBoundary;
    if (chunkSize >= maxChunkSize) {
      boundaries.push(i);
      lastBoundary = i;
      continue;
    }
    if (chunkSize < minChunkSize) continue;

    const prevText = messages[i - 1]!.content;
    const currText = messages[i]!.content;

    const filesPrev = extractFilePaths(prevText);
    const filesCurr = extractFilePaths(currText);
    const sharesFile = filesPrev.some(f => filesCurr.includes(f));

    const urlsPrev = extractUrls(prevText);
    const urlsCurr = extractUrls(currText);
    const sharesUrl = urlsPrev.some(u => urlsCurr.includes(u));

    const nounsPrev = extractNouns(prevText);
    const nounsCurr = extractNouns(currText);
    const sharesNoun = nounsPrev.some(n => nounsCurr.includes(n));

    const isPrevTool = /bash|execSync|run|execute/i.test(prevText);
    const isCurrLog = /error|exception|fail|exit code|stderr|stdout|logs/i.test(currText);
    const isToolFlow = isPrevTool && isCurrLog;

    const threshold = (sharesFile || sharesUrl || sharesNoun || isToolFlow) ? 0.20 : defaultThreshold;

    const sim = cosineSim(embeddings[i - 1]!, embeddings[i]!);
    if (sim < threshold) {
      boundaries.push(i);
      lastBoundary = i;
    }
  }

  return boundaries;
}

export async function semanticChunks(messages: Message[]): Promise<Message[][]> {
  if (!messages.length) return [];
  const boundaries = await findTopicBoundaries(messages);
  if (!boundaries.length) return [messages];

  const chunks: Message[][] = [];
  let prev = 0;
  for (const b of boundaries) {
    chunks.push(messages.slice(prev, b));
    prev = b;
  }
  if (prev < messages.length) {
    chunks.push(messages.slice(prev));
  }
  return chunks.filter(c => c.length > 0);
}

export function shouldSummarize(store: Store, branchId: string, config?: CompactionConfig): boolean {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  const messages = store.getMessages(branchId);
  if (messages.length < cfg.minMessages) return false;
  const summaries = store.getSummaries(branchId);
  const summarizedUpToTurn = summaries.length ? Math.max(...summaries.map(s => s.toTurn)) : -1;
  const hotStartIdx = Math.max(0, messages.length - cfg.hotWindow);
  const unsummarized = messages.slice(0, hotStartIdx).filter(m => m.turn > summarizedUpToTurn);
  return unsummarized.length >= cfg.unsummarizedThreshold;
}

export function messagesToSummarize(store: Store, branchId: string, config?: CompactionConfig): Message[] {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  const messages = store.getMessages(branchId);
  const summaries = store.getSummaries(branchId);
  const summarizedUpToTurn = summaries.length ? Math.max(...summaries.map(s => s.toTurn)) : -1;
  const hotStartIdx = Math.max(0, messages.length - cfg.hotWindow);
  return messages.slice(0, hotStartIdx).filter(m => m.turn > summarizedUpToTurn);
}

export async function runSummary(store: Store, router: Router, branchId: string): Promise<Summary | null> {
  if (!shouldSummarize(store, branchId)) return null;

  const branch = store.getBranch(branchId);
  if (!branch) return null;

  const batch = messagesToSummarize(store, branchId);
  if (!batch.length) return null;

  const chunks = await semanticChunks(batch);
  if (!chunks.length) return null;

  const chunk = chunks[0]!;
  const actualFrom = chunk[0]!.turn;
  const actualTo = chunk[chunk.length - 1]!.turn;

  let prompt = "Summarize these conversation turns:\n\n";
  for (const m of chunk) {
    const prefix = m.role === "user" ? "User" : "Assistant";
    // withToolTrail: the summary must keep identifiers the turn's tool calls
    // produced (page ids, URLs) — they only exist in the trail, not content.
    prompt += `${prefix}: ${withToolTrail(m)}\n\n`;
  }

  try {
    const result = await router.call(summaryModel(branch.model), [{ role: "user", content: prompt }], SUMMARY_SYSTEM);
    if (result.text) {
      return store.addSummary(branchId, actualFrom, actualTo, result.text.trim());
    }
  } catch (e: any) {
    console.error("  [summarizer] Warning: summary call failed:", e.message);
  }
  return null;
}

export async function runPendingSummaries(store: Store, router: Router, branchId: string): Promise<boolean> {
  let generated = false;
  while (shouldSummarize(store, branchId)) {
    const s = await runSummary(store, router, branchId);
    if (!s) break;
    generated = true;
  }
  await runProgressive(store, router, branchId);
  return generated;
}

export async function runProgressive(store: Store, router: Router, branchId: string): Promise<Summary | null> {
  const branch = store.getBranch(branchId);
  if (!branch) return null;

  const summaries = store.getSummaries(branchId);
  const META_SUMMARY_THRESHOLD = 5;
  if (summaries.length < META_SUMMARY_THRESHOLD) return null;

  const toCollapse = summaries.slice(0, -2);
  const keep = summaries.slice(-2);

  let prompt = "Produce a higher-level summary from these conversation summaries:\n\n";
  for (const s of toCollapse) {
    prompt += `[Turns ${s.fromTurn}-${s.toTurn}]\n${s.content}\n\n`;
  }

  try {
    const result = await router.call(summaryModel(branch.model), [{ role: "user", content: prompt }], META_SUMMARY_SYSTEM);
    if (result.text) {
      const meta: Summary = {
        branchId,
        fromTurn: toCollapse[0]!.fromTurn,
        toTurn: toCollapse[toCollapse.length - 1]!.toTurn,
        content: result.text.trim(),
        timestamp: Date.now(),
      };
      store.replaceSummaries(branchId, [meta, ...keep]);
      return meta;
    }
  } catch (e: any) {
    console.error("  [summarizer] Warning: meta-summary failed:", e.message);
  }
  return null;
}

export async function runSummarizeMiddle(messages: Message[], model: string): Promise<string> {
  if (!messages.length) return "";

  let prompt = "Summarize these conversation turns concisely, preserving key details:\n\n";
  for (const m of messages) {
    const prefix = m.role === "user" ? "User" : "Assistant";
    prompt += `${prefix}: ${withToolTrail(m)}\n\n`;
  }

  try {
    const { Router } = await import("@squirl/providers");
    const router = Router.fromEnv();
    const result = await router.call(summaryModel(model), [{ role: "user", content: prompt }], SUMMARY_SYSTEM);
    return result.text.trim();
  } catch {
    const lines: string[] = [];
    for (const m of messages) {
      const prefix = m.role === "user" ? "User" : "Assistant";
      let snippet = m.content.slice(0, 200).replace(/\n/g, " ");
      if (m.content.length > 200) snippet += "...";
      lines.push(`${prefix} (turn ${m.turn}): ${snippet}`);
    }
    return lines.join("\n");
  }
}

export async function runSummarizeAncestry(messages: Message[], model: string): Promise<string> {
  let prompt = "Summarize this parent branch conversation history:\n\n";
  for (const m of messages) {
    const prefix = m.role === "user" ? "User" : "Assistant";
    prompt += `${prefix} (turn ${m.turn}): ${withToolTrail(m)}\n\n`;
  }

  try {
    const { Router } = await import("@squirl/providers");
    const router = Router.fromEnv();
    const result = await router.call(summaryModel(model), [{ role: "user", content: prompt }], ANCESTRY_SUMMARY_SYSTEM);
    return result.text.trim();
  } catch {
    const lines: string[] = [];
    for (const m of messages) {
      const prefix = m.role === "user" ? "User" : "Assistant";
      const snippet = m.content.slice(0, 200).replace(/\n/g, " ");
      lines.push(`${prefix} (turn ${m.turn}): ${snippet}`);
    }
    return lines.join("\n");
  }
}
