import { describe, it, expect } from "vitest";
import { pruneToolOutputs, estimatePruneSavings } from "../pruning.js";

type Msg = { role: string; content: string; toolName?: string };

function msg(role: string, content: string, toolName?: string): Msg {
  return { role, content, ...(toolName ? { toolName } : {}) };
}

function bigContent(size: number): string {
  return "x".repeat(size);
}

// Default config values used in expectations
const DEFAULT_PRUNE_MIN = 20_000;
const DEFAULT_PROTECT_RECENT = 40_000;
const DEFAULT_KEEP_CHARS = 2_000;

describe("pruneToolOutputs", () => {
  describe("non-tool messages are never pruned", () => {
    it("does not prune user messages even when large", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 1_000);
      const messages: Msg[] = [
        msg("user", large),
        msg("user", bigContent(100)), // keep it out of recent zone
      ];
      // Make total > protect recent so first message is outside zone
      const longMessages = [
        msg("user", large),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(longMessages);
      expect(result[0]!.content).toBe(large);
    });

    it("does not prune assistant messages even when large", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 1_000);
      const messages: Msg[] = [
        msg("assistant", large),
        msg("assistant", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toBe(large);
    });
  });

  describe("small tool outputs are not pruned", () => {
    it("skips tool_result messages smaller than pruneMinimum", () => {
      const small = bigContent(DEFAULT_PRUNE_MIN - 1);
      const messages: Msg[] = [
        msg("tool_result", small, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toBe(small);
    });

    it("skips tool_result messages exactly at pruneMinimum boundary minus one", () => {
      const atBoundary = bigContent(DEFAULT_PRUNE_MIN - 1);
      const messages: Msg[] = [
        msg("tool_result", atBoundary, "bash"),
        msg("assistant", bigContent(DEFAULT_PROTECT_RECENT + 5_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toBe(atBoundary);
      expect(result[0]!.content.length).toBe(DEFAULT_PRUNE_MIN - 1);
    });

    it("uses custom pruneMinimum when specified", () => {
      const content = bigContent(5_000);
      const messages: Msg[] = [
        msg("tool_result", content, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      // With a smaller pruneMinimum of 3000, this should get pruned
      const result = pruneToolOutputs(messages, { pruneMinimum: 3_000 });
      expect(result[0]!.content).toContain("pruned");
    });
  });

  describe("large tool outputs in recent zone are not pruned", () => {
    it("protects large tool outputs within the recent window", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      // Only one message — it's both the start and inside the recent zone
      const messages: Msg[] = [msg("tool_result", large, "bash")];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toBe(large);
    });

    it("does not prune when total chars <= protectRecent", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 1_000);
      // Total content < 40000, so everything is in the recent zone
      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toBe(large);
    });

    it("protects last message that is in the recent zone even with older messages", () => {
      const old = bigContent(DEFAULT_PRUNE_MIN + 1_000);
      const recent = bigContent(DEFAULT_PRUNE_MIN + 1_000);
      // Total = old + recent; recent starts at old.length, which equals protectRecent boundary
      // We'll ensure old is outside and recent is inside by using custom config
      const messages: Msg[] = [
        msg("tool_result", old, "bash"),
        msg("tool_result", recent, "bash"),
      ];
      const result = pruneToolOutputs(messages, {
        protectRecent: recent.length + 1,
        pruneMinimum: DEFAULT_PRUNE_MIN,
      });
      // Recent message should be untouched
      expect(result[1]!.content).toBe(recent);
    });
  });

  describe("large tool outputs outside recent zone are pruned", () => {
    it("prunes large tool_result messages outside the recent window", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toContain("pruned");
      expect(result[0]!.content.length).toBeLessThan(large.length);
    });

    it("pruned result contains the pruned marker with char count", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).toMatch(/chars pruned/);
    });

    it("pruned result keeps head and tail content", () => {
      // Create content with identifiable head/tail
      const head = "HEAD".repeat(500); // 2000 chars
      const body = "M".repeat(DEFAULT_PRUNE_MIN + 10_000);
      const tail = "TAIL".repeat(500); // 2000 chars
      const large = head + body + tail;

      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages, { prunedKeepChars: 4_000 });
      const pruned = result[0]!.content;

      // Should start with some of the head
      expect(pruned.slice(0, 4)).toBe("HEAD");
      // Should end with some of the tail
      expect(pruned.slice(-4)).toBe("TAIL");
    });

    it("pruned content total is approximately prunedKeepChars + marker", () => {
      const keepChars = 2_000;
      const large = bigContent(DEFAULT_PRUNE_MIN + 10_000);
      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages, { prunedKeepChars: keepChars });
      const prunedLen = result[0]!.content.length;
      // prunedKeepChars chars + marker text
      expect(prunedLen).toBeGreaterThan(keepChars);
      expect(prunedLen).toBeLessThan(keepChars + 200); // marker is small
    });

    it("preserves role and toolName on pruned messages", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      const messages: Msg[] = [
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.role).toBe("tool_result");
      expect(result[0]!.toolName).toBe("bash");
    });
  });

  describe("protected tools are never pruned", () => {
    const protectedToolNames = ["skill", "read", "knowledge_base"];

    for (const toolName of protectedToolNames) {
      it(`does not prune tool_result from protected tool: ${toolName}`, () => {
        const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
        const messages: Msg[] = [
          msg("tool_result", large, toolName),
          msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
        ];
        const result = pruneToolOutputs(messages);
        expect(result[0]!.content).toBe(large);
        expect(result[0]!.content).not.toContain("pruned");
      });
    }

    it("prunes unprotected tools but not protected tools in the same conversation", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      const messages: Msg[] = [
        msg("tool_result", large, "skill"),
        msg("tool_result", large, "bash"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages);
      expect(result[0]!.content).not.toContain("pruned"); // skill protected
      expect(result[1]!.content).toContain("pruned"); // bash pruned
    });

    it("custom protectedTools config overrides defaults", () => {
      const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
      const messages: Msg[] = [
        msg("tool_result", large, "custom_tool"),
        msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
      ];
      const result = pruneToolOutputs(messages, {
        protectedTools: ["custom_tool"],
      });
      expect(result[0]!.content).not.toContain("pruned");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      expect(pruneToolOutputs([])).toEqual([]);
    });

    it("returns messages unchanged when nothing qualifies for pruning", () => {
      const messages: Msg[] = [
        msg("user", "Hello"),
        msg("assistant", "Hi there"),
      ];
      const result = pruneToolOutputs(messages);
      expect(result).toEqual(messages);
    });
  });
});

describe("estimatePruneSavings", () => {
  it("returns 0 when nothing would be pruned (all messages are in recent zone)", () => {
    const messages: Msg[] = [
      msg("tool_result", bigContent(DEFAULT_PRUNE_MIN + 1_000), "bash"),
    ];
    expect(estimatePruneSavings(messages)).toBe(0);
  });

  it("returns 0 when there are no tool_result messages", () => {
    const messages: Msg[] = [
      msg("user", bigContent(DEFAULT_PRUNE_MIN + 5_000)),
      msg("assistant", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    expect(estimatePruneSavings(messages)).toBe(0);
  });

  it("returns 0 when tool outputs are below pruneMinimum", () => {
    const messages: Msg[] = [
      msg("tool_result", bigContent(DEFAULT_PRUNE_MIN - 1), "bash"),
      msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    expect(estimatePruneSavings(messages)).toBe(0);
  });

  it("returns 0 for protected tools even when large and outside recent zone", () => {
    const messages: Msg[] = [
      msg("tool_result", bigContent(DEFAULT_PRUNE_MIN + 5_000), "read"),
      msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    expect(estimatePruneSavings(messages)).toBe(0);
  });

  it("returns positive number when pruning would help", () => {
    const large = bigContent(DEFAULT_PRUNE_MIN + 5_000);
    const messages: Msg[] = [
      msg("tool_result", large, "bash"),
      msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    const savings = estimatePruneSavings(messages);
    expect(savings).toBeGreaterThan(0);
  });

  it("savings equals content.length minus prunedKeepChars for a single prunable message", () => {
    const contentSize = DEFAULT_PRUNE_MIN + 10_000;
    const large = bigContent(contentSize);
    const messages: Msg[] = [
      msg("tool_result", large, "bash"),
      msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    const savings = estimatePruneSavings(messages);
    expect(savings).toBe(contentSize - DEFAULT_KEEP_CHARS);
  });

  it("accumulates savings across multiple prunable messages", () => {
    const contentSize = DEFAULT_PRUNE_MIN + 5_000;
    const messages: Msg[] = [
      msg("tool_result", bigContent(contentSize), "bash"),
      msg("tool_result", bigContent(contentSize), "grep"),
      msg("user", bigContent(DEFAULT_PROTECT_RECENT + 1_000)),
    ];
    const savings = estimatePruneSavings(messages);
    expect(savings).toBe((contentSize - DEFAULT_KEEP_CHARS) * 2);
  });

  it("returns 0 for empty messages array", () => {
    expect(estimatePruneSavings([])).toBe(0);
  });
});
