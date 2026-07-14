import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "@squirl/providers";
import type { MetaGraph } from "@squirl/graph-engine";
import { getConfig } from "@squirl/providers";

export interface ClassifierResult {
  significant: boolean;
  topic?: string;
  intent?: string;
  decision?: string;
  constraint?: string;
  artifact?: { type: string; title: string };
  supersedes?: string; // topic of decision this overrides
  relatedTopics?: string[];
}

interface PendingTurn {
  userMsg: string;
  assistantMsg: string;
  branchId: string;
  turnNum: number;
}

const CLASSIFIER_PROMPT = `Analyze this conversation turn for organizational knowledge extraction. Identify:
1. Decisions (architectural, design, process, or strategic choices)
2. Constraints (requirements, limitations, rules that must be followed)
3. Artifacts (documents, code, plans, specifications produced)
4. Relationships (does this supersede a previous decision? relate to other topics?)

Respond with ONLY valid JSON:
{
  "significant": true/false,
  "topic": "category/subcategory",
  "intent": "what was being discussed/decided",
  "decision": "what was decided (null if none)",
  "constraint": "any constraint established (null if none)",
  "artifact": {"type": "prd|code|plan|architecture|research|design", "title": "artifact name"} or null,
  "supersedes": "topic of previous decision this overrides (null if none)",
  "relatedTopics": ["related topic 1", "related topic 2"] or []
}

If not significant (casual chat, acknowledgements, simple Q&A), respond: {"significant": false}`;

let pending: PendingTurn[] = [];
let enrichQueue: PendingTurn[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let queuePath = "";
let enrichPath = "";
let localPipeline: any = null;
let localModelFailed = false;
let _nodeCounterRef: { current: number } | null = null;
let _dataDir = "";

function savePending() {
  if (!queuePath) return;
  mkdirSync(join(queuePath, ".."), { recursive: true });
  writeFileSync(queuePath, JSON.stringify(pending));
}

function saveEnrich() {
  if (!enrichPath) return;
  writeFileSync(enrichPath, JSON.stringify(enrichQueue));
}

/** Persist the max node ID so restarts don't collide. */
function persistNodeCounter(counter: { current: number }) {
  if (!_dataDir) return;
  const metaPath = join(_dataDir, "graph_meta.json");
  writeFileSync(metaPath, JSON.stringify({ maxNodeId: counter.current }));
}

/** Load persisted max node ID. */
export function loadNodeCounter(dataDir: string): number {
  const metaPath = join(dataDir, "graph_meta.json");
  if (!existsSync(metaPath)) return 0;
  try {
    const data = JSON.parse(readFileSync(metaPath, "utf-8"));
    return data.maxNodeId || 0;
  } catch { return 0; }
}

export function loadPending(dataDir?: string): PendingTurn[] {
  const dir = dataDir ?? join(process.cwd(), "data");
  _dataDir = dir;
  mkdirSync(dir, { recursive: true });
  queuePath = join(dir, "classifier_queue.json");
  enrichPath = join(dir, "classifier_enrich.json");
  if (existsSync(queuePath)) {
    try { pending = JSON.parse(readFileSync(queuePath, "utf-8")); } catch { pending = []; }
  }
  if (existsSync(enrichPath)) {
    try { enrichQueue = JSON.parse(readFileSync(enrichPath, "utf-8")); } catch { enrichQueue = []; }
  }
  return pending;
}

const SIGNIFICANCE_LABELS = ["significant decision", "trivial chatter"];

async function classifyLocal(userMsg: string, assistantMsg: string): Promise<ClassifierResult> {
  if (localModelFailed) throw new Error("local model unavailable");
  if (!localPipeline) {
    const { pipeline } = await import("@huggingface/transformers");
    localPipeline = await pipeline("zero-shot-classification", "Xenova/mobilebert-uncased-mnli", { dtype: "fp32" });
  }
  const text = `User: ${userMsg}\nAssistant: ${assistantMsg.slice(0, 300)}`;
  const result = await localPipeline(text, SIGNIFICANCE_LABELS);
  const topLabel = result.labels[0];
  if (topLabel === "significant decision" && result.scores[0] > 0.6) {
    return { significant: true, topic: "unknown", intent: userMsg.slice(0, 80) };
  }
  return { significant: false };
}

async function classifyAPI(router: Router, userMsg: string, assistantMsg: string): Promise<ClassifierResult> {
  const cfg = getConfig();
  const messages = [
    { role: "user" as const, content: `User: ${userMsg}\n\nAssistant: ${assistantMsg.slice(0, 1500)}` },
  ];
  const result = await router.call(cfg.classifierModel, messages, CLASSIFIER_PROMPT);
  const json = result.text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { significant: false };
  try {
    const parsed = JSON.parse(json);
    return {
      significant: !!parsed.significant,
      topic: parsed.topic || undefined,
      intent: parsed.intent || undefined,
      decision: parsed.decision || undefined,
      constraint: parsed.constraint || undefined,
      artifact: parsed.artifact || undefined,
      supersedes: parsed.supersedes || undefined,
      relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
    };
  } catch {
    return { significant: false };
  }
}

async function indexResult(result: ClassifierResult, turn: PendingTurn, graph: MetaGraph, nodeCounter: { current: number }) {
  if (!result.significant) return;

  nodeCounter.current++;
  persistNodeCounter(nodeCounter);

  await graph.addNode(nodeCounter.current, {
    ...result,
    _turn: turn.turnNum,
    _branch: turn.branchId,
    _timestamp: Date.now(),
  });
}

async function drainEnrichQueue(router: Router, graph: MetaGraph, nodeCounter: { current: number }) {
  while (enrichQueue.length > 0) {
    const turn = enrichQueue[0]!;
    try {
      const result = await classifyAPI(router, turn.userMsg, turn.assistantMsg);
      enrichQueue.shift();
      saveEnrich();
      await indexResult(result, turn, graph, nodeCounter);
    } catch { return; }
  }
}

function scheduleRetry(router: Router, graph: MetaGraph, nodeCounter: { current: number }) {
  if (retryTimer || pending.length === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    drainQueue(router, graph, nodeCounter);
  }, retryDelay);
}

async function drainQueue(router: Router, graph: MetaGraph, nodeCounter: { current: number }) {
  while (pending.length > 0) {
    const turn = pending[0]!;
    try {
      let result: ClassifierResult;
      let usedLocal = false;
      try {
        result = await classifyAPI(router, turn.userMsg, turn.assistantMsg);
      } catch {
        try {
          result = await classifyLocal(turn.userMsg, turn.assistantMsg);
          usedLocal = true;
        } catch {
          localModelFailed = true;
          throw new Error("both failed");
        }
      }
      pending.shift();
      savePending();
      retryDelay = 2000;
      await indexResult(result, turn, graph, nodeCounter);
      if (usedLocal && result.significant) {
        enrichQueue.push(turn);
        saveEnrich();
      }
    } catch {
      retryDelay = Math.min(retryDelay * 2, 30000);
      scheduleRetry(router, graph, nodeCounter);
      return;
    }
  }

  if (enrichQueue.length > 0) {
    await drainEnrichQueue(router, graph, nodeCounter);
  }
}

export function resumeQueue(router: Router, graph: MetaGraph, nodeCounter: { current: number }): void {
  _nodeCounterRef = nodeCounter;
  if ((pending.length > 0 || enrichQueue.length > 0) && !retryTimer) {
    drainQueue(router, graph, nodeCounter);
  }
}

export function classifyAndIndex(
  router: Router,
  graph: MetaGraph,
  nodeCounter: { current: number },
  userMsg: string,
  assistantMsg: string,
  branchId: string,
  turnNum: number,
): void {
  const cfg = getConfig();
  if (!cfg.classifier.enabled) return;

  pending.push({ userMsg, assistantMsg, branchId, turnNum });
  savePending();

  if (pending.length === 1 && !retryTimer) {
    drainQueue(router, graph, nodeCounter);
  }
}
