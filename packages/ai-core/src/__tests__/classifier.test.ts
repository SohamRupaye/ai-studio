import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Router } from "@squirl/providers";
import type { MetaGraph } from "@squirl/graph-engine";

const getConfigMock = vi.fn(() => ({ classifier: { enabled: true }, classifierModel: "test-model" }));
vi.mock("@squirl/providers", () => ({ getConfig: getConfigMock }));

// classifyLocal does `const { pipeline } = await import("@huggingface/transformers")`
// then `localPipeline = await pipeline(...)` then calls `localPipeline(text, labels)`.
// This ref lets each test control what the "model" returns/throws without touching a real model.
let pipelineImpl: () => Promise<(text: string, labels: string[]) => Promise<{ labels: string[]; scores: number[] }>> =
  async () => async () => ({ labels: ["significant decision", "trivial chatter"], scores: [0.9, 0.1] });
vi.mock("@huggingface/transformers", () => ({
  pipeline: (..._args: unknown[]) => pipelineImpl(),
}));

function makeRouter(call: (...args: unknown[]) => Promise<{ text: string }>): Router {
  return { call: vi.fn(call), stream: vi.fn() } as unknown as Router;
}

function makeGraph(): MetaGraph & { addNode: ReturnType<typeof vi.fn> } {
  return { addNode: vi.fn(async () => {}) } as unknown as MetaGraph & { addNode: ReturnType<typeof vi.fn> };
}

async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("classifier", () => {
  let dataDir: string;
  let classifier: typeof import("../classifier.js");

  beforeEach(async () => {
    vi.resetModules();
    pipelineImpl = async () => async () => ({ labels: ["significant decision", "trivial chatter"], scores: [0.9, 0.1] });
    dataDir = mkdtempSync(join(tmpdir(), "classifier-test-"));
    classifier = await import("../classifier.js");
    classifier.loadPending(dataDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("enqueues a turn, persists it to disk, and indexes it once classified as significant", async () => {
    const router = makeRouter(async () => ({
      text: JSON.stringify({ significant: true, topic: "arch/db", intent: "chose sqlite" }),
    }));
    const graph = makeGraph();
    const nodeCounter = { current: 0 };

    classifier.classifyAndIndex(router, graph as unknown as MetaGraph, nodeCounter, "use sqlite", "ok, using sqlite", "branch-1", 1);

    // Persisted synchronously before the async drain settles.
    const queuedRightAway = JSON.parse(readFileSync(join(dataDir, "classifier_queue.json"), "utf-8"));
    expect(queuedRightAway).toHaveLength(1);

    await waitUntil(() => graph.addNode.mock.calls.length > 0);

    expect(graph.addNode).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ significant: true, topic: "arch/db", _branch: "branch-1", _turn: 1 }),
    );
    const queuedAfterDrain = JSON.parse(readFileSync(join(dataDir, "classifier_queue.json"), "utf-8"));
    expect(queuedAfterDrain).toEqual([]);
  });

  it("does not index a turn classified as insignificant", async () => {
    const router = makeRouter(async () => ({ text: JSON.stringify({ significant: false }) }));
    const graph = makeGraph();
    const nodeCounter = { current: 0 };

    classifier.classifyAndIndex(router, graph as unknown as MetaGraph, nodeCounter, "hey", "hi there", "branch-1", 1);

    await waitUntil(() => JSON.parse(readFileSync(join(dataDir, "classifier_queue.json"), "utf-8")).length === 0);

    expect(graph.addNode).not.toHaveBeenCalled();
  });

  it("treats a malformed/non-JSON API response as insignificant without throwing", async () => {
    const router = makeRouter(async () => ({ text: "not json at all" }));
    const graph = makeGraph();
    const nodeCounter = { current: 0 };

    classifier.classifyAndIndex(router, graph as unknown as MetaGraph, nodeCounter, "hey", "hi there", "branch-1", 1);

    await waitUntil(() => JSON.parse(readFileSync(join(dataDir, "classifier_queue.json"), "utf-8")).length === 0);

    expect(graph.addNode).not.toHaveBeenCalled();
  });

  it("falls back to local classification on API failure, then re-classifies via API through the enrich queue", async () => {
    let apiCallCount = 0;
    const router = makeRouter(async () => {
      apiCallCount++;
      if (apiCallCount === 1) throw new Error("network down");
      return { text: JSON.stringify({ significant: true, topic: "final", intent: "resolved via api" }) };
    });
    const graph = makeGraph();
    const nodeCounter = { current: 0 };

    classifier.classifyAndIndex(router, graph as unknown as MetaGraph, nodeCounter, "let's use redis", "ok, redis it is", "branch-2", 5);

    await waitUntil(() => graph.addNode.mock.calls.length >= 2);

    expect(apiCallCount).toBe(2);
    // First index comes from the local fallback classifier (classifyLocal's fixed shape).
    expect(graph.addNode).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ significant: true, topic: "unknown" }));
    // Second index comes from the enrich queue re-classifying via the (now-healthy) API.
    expect(graph.addNode).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ significant: true, topic: "final" }));

    const enrichQueue = JSON.parse(readFileSync(join(dataDir, "classifier_enrich.json"), "utf-8"));
    expect(enrichQueue).toEqual([]);
  });

  it("schedules a backoff retry (doesn't re-drain synchronously) when both API and local classification fail", async () => {
    const router = makeRouter(async () => {
      throw new Error("network down");
    });
    const graph = makeGraph();
    const nodeCounter = { current: 0 };

    // Warm the dynamic `import("@huggingface/transformers")` under real timers first —
    // module resolution takes a real async tick even when mocked, which fake timers won't advance.
    await import("@huggingface/transformers");
    pipelineImpl = async () => {
      throw new Error("model unavailable");
    };

    vi.useFakeTimers();
    try {
      classifier.classifyAndIndex(router, graph as unknown as MetaGraph, nodeCounter, "hey", "hi there", "branch-1", 1);
      await vi.waitFor(() => {
        if (vi.getTimerCount() === 0) throw new Error("retry timer not scheduled yet");
      });

      expect(graph.addNode).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const callsBeforeRetry = (router.call as ReturnType<typeof vi.fn>).mock.calls.length;

      // First retry is scheduled at 4000ms (2000ms base, doubled on first failure).
      await vi.advanceTimersByTimeAsync(4000);
      const callsAfterRetry = (router.call as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfterRetry).toBeGreaterThan(callsBeforeRetry);
    } finally {
      vi.useRealTimers();
    }
  });
});
