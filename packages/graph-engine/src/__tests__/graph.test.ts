import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cosineSim, MetaGraph } from "../graph.js";

describe("cosineSim", () => {
  it("returns 1 for identical unit vectors [1,0]", () => {
    expect(cosineSim([1, 0], [1, 0])).toBe(1);
  });

  it("returns 1 for identical unit vectors [0,1]", () => {
    expect(cosineSim([0, 1], [0, 1])).toBe(1);
  });

  it("returns 0 for orthogonal unit vectors [1,0] and [0,1]", () => {
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });

  it("returns -1 for opposite unit vectors [1,0] and [-1,0]", () => {
    expect(cosineSim([1, 0], [-1, 0])).toBe(-1);
  });

  it("returns 0 for empty first vector", () => {
    expect(cosineSim([], [1, 0])).toBe(0);
  });

  it("returns 0 for empty second vector", () => {
    expect(cosineSim([1, 0], [])).toBe(0);
  });

  it("returns 0 for both empty vectors", () => {
    expect(cosineSim([], [])).toBe(0);
  });

  it("returns ~1 for pre-normalized vector [0.6,0.8] with itself", () => {
    const result = cosineSim([0.6, 0.8], [0.6, 0.8]);
    // 0.6*0.6 + 0.8*0.8 = 0.36 + 0.64 = 1.0
    expect(result).toBeCloseTo(1.0, 10);
  });

  it("correctly computes dot product for non-unit vectors", () => {
    // cosineSim works on pre-normalized vectors — it's a raw dot product
    // [2,0] · [2,0] = 4
    expect(cosineSim([2, 0], [2, 0])).toBe(4);
  });

  it("returns 0 when one vector is all zeros", () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });

  it("handles 3D pre-normalized vectors", () => {
    const a = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    const result = cosineSim(a, a);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns negative value for partially opposing vectors", () => {
    // [0.6, -0.8] · [0.6, 0.8] = 0.36 - 0.64 = -0.28
    const result = cosineSim([0.6, -0.8], [0.6, 0.8]);
    expect(result).toBeCloseTo(-0.28, 5);
  });
});

describe("MetaGraph", () => {
  let tempDir: string;
  let graph: MetaGraph;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "metagraph-test-"));
    graph = new MetaGraph(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("has size === 0 on a fresh graph", () => {
    expect(graph.size).toBe(0);
  });

  it("has edgeCount === 0 on a fresh graph", () => {
    expect(graph.edgeCount).toBe(0);
  });

  it("summary() returns { nodeCount: 0, edgeCount: 0, domains: {} } for empty graph", () => {
    expect(graph.summary()).toEqual({ nodeCount: 0, edgeCount: 0, domains: {} });
  });

  it("getNode(999) returns undefined when node does not exist", () => {
    expect(graph.getNode(999)).toBeUndefined();
  });

  it("getNode(0) returns undefined for non-existent id 0", () => {
    expect(graph.getNode(0)).toBeUndefined();
  });

  it("getNeighbors(999) returns [] for non-existent node", () => {
    expect(graph.getNeighbors(999)).toEqual([]);
  });

  it("getNeighbors(0) returns [] for non-existent node 0", () => {
    expect(graph.getNeighbors(0)).toEqual([]);
  });

  it("creates a fresh SQLite database in the provided directory", async () => {
    const { existsSync } = await import("fs");
    expect(existsSync(join(tempDir, "graph.db"))).toBe(true);
  });

  it("summary() nodeCount matches size", () => {
    const s = graph.summary();
    expect(s.nodeCount).toBe(graph.size);
    expect(s.edgeCount).toBe(graph.edgeCount);
  });

  it("buildText returns empty string for empty meta", () => {
    // buildText joins topic, intent, decision, constraint — all undefined → empty
    expect(graph.buildText({})).toBe("");
  });

  it("buildText includes topic in output", () => {
    const text = graph.buildText({ topic: "auth/login" });
    expect(text).toContain("auth/login");
  });

  it("buildText joins all present fields with ` — `", () => {
    const text = graph.buildText({ topic: "A", intent: "B", decision: "C", constraint: "D" });
    expect(text).toBe("A — B — C — D");
  });

  it("buildText skips undefined fields", () => {
    const text = graph.buildText({ topic: "A", decision: "C" });
    expect(text).toBe("A — C");
  });
});
