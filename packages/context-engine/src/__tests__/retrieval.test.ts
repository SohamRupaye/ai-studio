import { describe, it, expect } from "vitest";
import { mmrRerank } from "../retrieval.js";

type Candidate = { id: number; score: number; meta: Record<string, any>; embedding: number[] };

function candidate(id: number, score: number, embedding: number[], meta: Record<string, any> = {}): Candidate {
  return { id, score, embedding, meta };
}

describe("mmrRerank", () => {
  describe("empty and trivial cases", () => {
    it("returns [] for empty candidates", () => {
      expect(mmrRerank([1, 0], [])).toEqual([]);
    });

    it("returns the single candidate when there is only one", () => {
      const result = mmrRerank([1, 0], [candidate(1, 0.9, [1, 0])]);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(1);
    });

    it("returns all candidates when topK > candidates.length", () => {
      const candidates = [
        candidate(1, 0.9, [1, 0]),
        candidate(2, 0.8, [0, 1]),
      ];
      const result = mmrRerank([1, 0], candidates, 5);
      expect(result).toHaveLength(2);
    });

    it("returns at most topK candidates", () => {
      const candidates = [
        candidate(1, 0.9, [1, 0]),
        candidate(2, 0.85, [0.6, 0.8]),
        candidate(3, 0.8, [0, 1]),
        candidate(4, 0.75, [-1, 0]),
      ];
      const result = mmrRerank([1, 0], candidates, 2);
      expect(result).toHaveLength(2);
    });

    it("returns [] when topK is 0", () => {
      const candidates = [candidate(1, 0.9, [1, 0])];
      const result = mmrRerank([1, 0], candidates, 0);
      expect(result).toHaveLength(0);
    });
  });

  describe("result shape", () => {
    it("result items have id, score, meta but NOT embedding", () => {
      const result = mmrRerank([1, 0], [candidate(42, 0.9, [1, 0], { title: "test" })]);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("score");
      expect(result[0]).toHaveProperty("meta");
      expect(result[0]).not.toHaveProperty("embedding");
    });

    it("preserves the original id values", () => {
      const candidates = [
        candidate(101, 0.9, [1, 0]),
        candidate(202, 0.8, [0, 1]),
      ];
      const result = mmrRerank([1, 0], candidates, 2);
      const ids = result.map(r => r.id).sort();
      expect(ids).toEqual([101, 202]);
    });

    it("preserves the original score values", () => {
      const candidates = [candidate(1, 0.75, [1, 0])];
      const result = mmrRerank([1, 0], candidates);
      expect(result[0]!.score).toBe(0.75);
    });

    it("preserves meta fields", () => {
      const meta = { topic: "auth", decision: "use JWT" };
      const candidates = [candidate(1, 0.9, [1, 0], meta)];
      const result = mmrRerank([1, 0], candidates);
      expect(result[0]!.meta).toEqual(meta);
    });
  });

  describe("diversity enforcement", () => {
    it("includes the orthogonal candidate when 2 candidates share the same embedding and 1 is orthogonal", () => {
      // Candidates A and B are identical [1,0] (high similarity to query [1,0])
      // Candidate C is orthogonal [0,1] (low relevance but diverse)
      const candidates = [
        candidate(1, 0.95, [1, 0]),  // identical to query — very relevant
        candidate(2, 0.90, [1, 0]),  // also identical — redundant
        candidate(3, 0.50, [0, 1]),  // orthogonal — diverse
      ];
      const result = mmrRerank([1, 0], candidates, 2, 0.7);
      const ids = result.map(r => r.id);
      // First pick is id=1 (highest relevance), second should prefer id=3 (diverse)
      // because id=2 is identical to id=1 and gets penalised by MMR
      expect(ids).toContain(1);
      expect(ids).toContain(3);
    });

    it("with lambda=0 (pure diversity), picks maximally diverse candidates", () => {
      // lambda=0 means score = -(1-0)*maxSim = -maxSim, so it prefers least similar to selected
      const candidates = [
        candidate(1, 0.9, [1, 0]),
        candidate(2, 0.8, [0.6, 0.8]),
        candidate(3, 0.5, [0, 1]),  // orthogonal to [1,0]
      ];
      // First pick: when nothing selected, lambda*rel = 0, so all score 0 — first encountered wins
      // Second pick: prefers least similar to first pick
      const result = mmrRerank([1, 0], candidates, 2, 0);
      expect(result).toHaveLength(2);
    });
  });

  describe("lambda=1 picks by highest relevance score greedily", () => {
    it("with lambda=1, picks candidates in descending score order", () => {
      const candidates = [
        candidate(3, 0.7, [1, 0]),
        candidate(1, 0.95, [1, 0]),   // highest score
        candidate(2, 0.85, [0.6, 0.8]),
      ];
      const result = mmrRerank([1, 0], candidates, 3, 1.0);
      // With lambda=1, no diversity penalty, picks purely by relevance
      expect(result[0]!.id).toBe(1); // score 0.95
      expect(result[1]!.id).toBe(2); // score 0.85
      expect(result[2]!.id).toBe(3); // score 0.7
    });

    it("with lambda=1, identical embeddings do not affect ordering", () => {
      const candidates = [
        candidate(1, 0.9, [1, 0]),
        candidate(2, 0.95, [1, 0]),  // same embedding but higher score
      ];
      const result = mmrRerank([1, 0], candidates, 2, 1.0);
      expect(result[0]!.id).toBe(2); // higher score first
      expect(result[1]!.id).toBe(1);
    });
  });

  describe("default parameters", () => {
    it("defaults topK to 3", () => {
      const candidates = Array.from({ length: 5 }, (_, i) =>
        candidate(i + 1, 0.9 - i * 0.1, [Math.cos(i), Math.sin(i)])
      );
      const result = mmrRerank([1, 0], candidates);
      expect(result).toHaveLength(3);
    });

    it("defaults lambda to 0.7 (balances relevance and diversity)", () => {
      // With lambda=0.7, both relevance and diversity matter
      // This just ensures the function runs without explicit lambda
      const candidates = [
        candidate(1, 0.9, [1, 0]),
        candidate(2, 0.85, [0.6, 0.8]),
        candidate(3, 0.5, [0, 1]),
      ];
      const result = mmrRerank([1, 0], candidates);
      expect(result).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    it("handles zero-vector embeddings without crashing", () => {
      const candidates = [
        candidate(1, 0.5, [0, 0]),
        candidate(2, 0.8, [1, 0]),
      ];
      expect(() => mmrRerank([1, 0], candidates, 2)).not.toThrow();
    });

    it("handles single-element candidates with topK=1", () => {
      const result = mmrRerank([1, 0], [candidate(99, 0.7, [0.6, 0.8])], 1);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(99);
    });

    it("query embedding does not affect result shape", () => {
      const candidates = [candidate(1, 0.9, [1, 0])];
      const result = mmrRerank([0.6, 0.8], candidates);
      expect(result).toHaveLength(1);
    });
  });
});
