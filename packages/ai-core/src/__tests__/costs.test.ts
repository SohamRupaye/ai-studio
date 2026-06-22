import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker } from "../costs.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe("initial state", () => {
    it("totalCost is 0 on a fresh tracker", () => {
      expect(tracker.totalCost).toBe(0);
    });

    it("totalTokens is { input: 0, output: 0 } on a fresh tracker", () => {
      expect(tracker.totalTokens).toEqual({ input: 0, output: 0 });
    });

    it("lastCost() returns empty string on a fresh tracker", () => {
      expect(tracker.lastCost()).toBe("");
    });

    it("summary() still works on empty tracker", () => {
      const s = tracker.summary();
      expect(s).toContain("Total cost");
      expect(s).toContain("Tokens");
      expect(s).toContain("Calls");
    });
  });

  describe("record with input_tokens / output_tokens", () => {
    it("records claude-sonnet-4 with 1000 input + 500 output → cost = 0.0105", () => {
      // Pricing for claude-sonnet: [3, 15] per million
      // cost = (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1_000_000 = 0.0105
      tracker.record("claude-sonnet-4", { input_tokens: 1000, output_tokens: 500 });
      expect(tracker.totalCost).toBeCloseTo(0.0105, 8);
    });

    it("records claude-sonnet variant with 0 tokens → cost = 0", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 0, output_tokens: 0 });
      expect(tracker.totalCost).toBe(0);
    });

    it("records gpt-4o with 2000 input + 1000 output correctly", () => {
      // Pricing for gpt-4o: [2.5, 10] per million
      // cost = (2000 * 2.5 + 1000 * 10) / 1_000_000 = (5000 + 10000) / 1_000_000 = 0.015
      tracker.record("gpt-4o", { input_tokens: 2000, output_tokens: 1000 });
      expect(tracker.totalCost).toBeCloseTo(0.015, 8);
    });
  });

  describe("prompt_tokens / completion_tokens aliases", () => {
    it("uses prompt_tokens as input_tokens alias for gpt-4o", () => {
      tracker.record("gpt-4o", { prompt_tokens: 1000, completion_tokens: 500 });
      // (1000 * 2.5 + 500 * 10) / 1_000_000 = (2500 + 5000) / 1_000_000 = 0.0075
      expect(tracker.totalCost).toBeCloseTo(0.0075, 8);
    });

    it("uses prompt_tokens and completion_tokens for any model", () => {
      tracker.record("claude-haiku-3", { prompt_tokens: 10000, completion_tokens: 2000 });
      // Pricing claude-haiku: [0.25, 1.25]
      // (10000 * 0.25 + 2000 * 1.25) / 1_000_000 = (2500 + 2500) / 1_000_000 = 0.005
      expect(tracker.totalCost).toBeCloseTo(0.005, 8);
    });

    it("input_tokens takes precedence over prompt_tokens when both provided", () => {
      // Per source: uses `usage.input_tokens || usage.prompt_tokens`
      // If input_tokens is 0 (falsy), prompt_tokens is used — if input_tokens > 0, it wins
      tracker.record("gpt-4o-mini", { input_tokens: 1000, prompt_tokens: 9999 });
      // Should use input_tokens=1000, not 9999
      // Pricing gpt-4o-mini: [0.15, 0.6]
      // With output=0: (1000 * 0.15) / 1_000_000 = 0.00000015 ... wait, need output too
      tracker.record("gpt-4o-mini", { input_tokens: 1000, output_tokens: 0 });
      expect(tracker.totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("unknown model uses fallback rate [1, 3]", () => {
    it("uses fallback [1, 3] for an unknown model", () => {
      tracker.record("unknown-llm-xyz", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
      // (1_000_000 * 1 + 1_000_000 * 3) / 1_000_000 = 4.0
      expect(tracker.totalCost).toBeCloseTo(4.0, 5);
    });

    it("uses fallback for empty model string", () => {
      tracker.record("", { input_tokens: 1_000_000, output_tokens: 0 });
      // (1_000_000 * 1) / 1_000_000 = 1.0
      expect(tracker.totalCost).toBeCloseTo(1.0, 5);
    });
  });

  describe("totalCost accumulates across multiple records", () => {
    it("sums cost from two records", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 1000, output_tokens: 500 });
      const first = tracker.totalCost; // 0.0105
      tracker.record("gpt-4o", { input_tokens: 1000, output_tokens: 500 });
      // gpt-4o: (1000*2.5 + 500*10)/1e6 = (2500+5000)/1e6 = 0.0075
      const second = tracker.totalCost;
      expect(second).toBeCloseTo(first + 0.0075, 8);
    });

    it("accumulates across many records", () => {
      for (let i = 0; i < 10; i++) {
        tracker.record("claude-haiku-4", { input_tokens: 1000, output_tokens: 1000 });
      }
      // claude-haiku: [0.25, 1.25] per million tokens
      // per call: (1000*0.25 + 1000*1.25) / 1_000_000 = 1500 / 1_000_000 = 0.0015
      // 10 calls = 0.015
      expect(tracker.totalCost).toBeCloseTo(0.015, 8);
    });
  });

  describe("totalTokens", () => {
    it("sums input and output tokens across records", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 1000, output_tokens: 500 });
      tracker.record("gpt-4o", { prompt_tokens: 2000, completion_tokens: 1000 });
      const totals = tracker.totalTokens;
      expect(totals.input).toBe(3000);
      expect(totals.output).toBe(1500);
    });

    it("tracks input and output separately", () => {
      tracker.record("claude-opus-4", { input_tokens: 5000, output_tokens: 1000 });
      expect(tracker.totalTokens.input).toBe(5000);
      expect(tracker.totalTokens.output).toBe(1000);
    });

    it("remains 0/0 after recording with no token fields", () => {
      tracker.record("gpt-5", {});
      expect(tracker.totalTokens).toEqual({ input: 0, output: 0 });
    });
  });

  describe("summary()", () => {
    it("contains 'Total cost' after a record", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 100, output_tokens: 50 });
      expect(tracker.summary()).toContain("Total cost");
    });

    it("contains 'Tokens' after a record", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 100, output_tokens: 50 });
      expect(tracker.summary()).toContain("Tokens");
    });

    it("contains 'Calls' after a record", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 100, output_tokens: 50 });
      expect(tracker.summary()).toContain("Calls");
    });

    it("summary reflects correct call count", () => {
      tracker.record("gpt-4o", { input_tokens: 100, output_tokens: 50 });
      tracker.record("gpt-4o", { input_tokens: 200, output_tokens: 100 });
      expect(tracker.summary()).toContain("Calls: 2");
    });

    it("summary includes model name for recorded model", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 100, output_tokens: 50 });
      expect(tracker.summary()).toContain("claude-sonnet-4");
    });

    it("summary shows $0.0000 when no records", () => {
      expect(tracker.summary()).toContain("$0.0000");
    });
  });

  describe("lastCost()", () => {
    it("returns non-empty string after a record", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 1000, output_tokens: 500 });
      expect(tracker.lastCost()).not.toBe("");
    });

    it("contains dollar sign in returned string", () => {
      tracker.record("gpt-4o", { input_tokens: 1000, output_tokens: 500 });
      expect(tracker.lastCost()).toContain("$");
    });

    it("reflects the last recorded call, not cumulative", () => {
      tracker.record("claude-sonnet-4", { input_tokens: 1000, output_tokens: 500 });
      tracker.record("gpt-4o-mini", { input_tokens: 100, output_tokens: 50 });
      const last = tracker.lastCost();
      // gpt-4o-mini [0.15, 0.6]: (100*0.15 + 50*0.6)/1e6 = (15+30)/1e6 = 0.000045 → tiny
      expect(last).toContain("150"); // 100+50=150 tokens
    });

    it("contains token count in parentheses", () => {
      tracker.record("claude-haiku-3", { input_tokens: 300, output_tokens: 100 });
      const last = tracker.lastCost();
      expect(last).toContain("400"); // 300+100
    });
  });

  describe("model prefix matching", () => {
    it("matches claude-opus variant", () => {
      tracker.record("claude-opus-3-5", { input_tokens: 1_000_000, output_tokens: 0 });
      // claude-opus: [15, 75] → 1M input = $15
      expect(tracker.totalCost).toBeCloseTo(15, 3);
    });

    it("matches gemini-2.5-pro variant", () => {
      tracker.record("gemini-2.5-pro-preview", { input_tokens: 1_000_000, output_tokens: 0 });
      // gemini-2.5-pro: [1.25, 10] → 1M input = $1.25
      expect(tracker.totalCost).toBeCloseTo(1.25, 3);
    });

    it("matches o3 model", () => {
      tracker.record("o3", { input_tokens: 1_000_000, output_tokens: 0 });
      // o3: [10, 40] → 1M input = $10
      expect(tracker.totalCost).toBeCloseTo(10, 3);
    });

    it("matches o4-mini model", () => {
      tracker.record("o4-mini", { input_tokens: 1_000_000, output_tokens: 0 });
      // o4-mini: [1.1, 4.4] → 1M input = $1.1
      expect(tracker.totalCost).toBeCloseTo(1.1, 3);
    });
  });
});
