import { describe, it, expect } from "vitest";
import { cn, modelLabel, providerLogoKey } from "../renderer/lib/utils.js";

describe("modelLabel", () => {
  it("splits a subscription id into a bare name plus a billing hint", () => {
    // The raw id truncates to an indistinguishable "claude_subscription/clau…"
    // in the model menu, which is the bug this exists to prevent.
    expect(modelLabel("claude_subscription/claude-opus-4-8")).toEqual({
      label: "claude-opus-4-8",
      hint: "subscription",
    });
  });

  it("leaves ordinary ids untouched and adds no hint", () => {
    expect(modelLabel("claude-opus-4-8")).toEqual({ label: "claude-opus-4-8" });
    expect(modelLabel("gpt-5.4-mini")).toEqual({ label: "gpt-5.4-mini" });
    expect(modelLabel("bedrock/claude-opus-4-8")).toEqual({ label: "bedrock/claude-opus-4-8" });
  });
});

describe("providerLogoKey", () => {
  it("maps router entry names to their brand logo key", () => {
    expect(providerLogoKey("claude_subscription")).toBe("anthropic");
    expect(providerLogoKey("codex_oauth")).toBe("codex");
  });

  it("passes through entries already named after the brand", () => {
    expect(providerLogoKey("anthropic")).toBe("anthropic");
    expect(providerLogoKey("groq")).toBe("groq");
  });
});

describe("cn (clsx + tailwind-merge)", () => {
  describe("basic class merging", () => {
    it("returns empty string when called with no arguments", () => {
      expect(cn()).toBe("");
    });

    it("returns the class when called with a single class string", () => {
      expect(cn("foo")).toBe("foo");
    });

    it("joins multiple class strings with a space", () => {
      expect(cn("foo", "bar")).toBe("foo bar");
    });

    it("joins three or more class strings", () => {
      expect(cn("a", "b", "c")).toBe("a b c");
    });
  });

  describe("falsy value filtering", () => {
    it("ignores false values", () => {
      expect(cn("a", false, "b")).toBe("a b");
    });

    it("ignores null values", () => {
      expect(cn("a", null, "b")).toBe("a b");
    });

    it("ignores undefined values", () => {
      expect(cn("a", undefined, "b")).toBe("a b");
    });

    it("ignores all falsy values in mixed input", () => {
      expect(cn("a", false, null, undefined, "b")).toBe("a b");
    });

    it("returns empty string when all inputs are falsy", () => {
      expect(cn(false, null, undefined)).toBe("");
    });

    it("ignores 0 as falsy", () => {
      // clsx treats 0 as falsy
      expect(cn("a", 0 as any, "b")).toBe("a b");
    });
  });

  describe("conditional classes via object syntax", () => {
    it("includes class when condition is true", () => {
      expect(cn({ active: true })).toBe("active");
    });

    it("excludes class when condition is false", () => {
      expect(cn({ active: true, disabled: false })).toBe("active");
    });

    it("excludes all classes when all conditions are false", () => {
      expect(cn({ active: false, disabled: false })).toBe("");
    });

    it("includes multiple classes when all conditions are true", () => {
      const result = cn({ active: true, visible: true });
      expect(result).toContain("active");
      expect(result).toContain("visible");
    });

    it("mixes object and string inputs", () => {
      const result = cn("base", { active: true, disabled: false });
      expect(result).toContain("base");
      expect(result).toContain("active");
      expect(result).not.toContain("disabled");
    });
  });

  describe("array syntax", () => {
    it("flattens array of classes", () => {
      expect(cn(["a", "b"])).toBe("a b");
    });

    it("flattens nested arrays", () => {
      expect(cn(["a", ["b", "c"]])).toBe("a b c");
    });

    it("filters falsy values inside arrays", () => {
      expect(cn(["a", false, "b"])).toBe("a b");
    });
  });

  describe("tailwind-merge conflict resolution", () => {
    it("resolves padding conflict — last p wins (p-8 overrides p-4)", () => {
      expect(cn("p-4", "p-8")).toBe("p-8");
    });

    it("resolves text color conflict — last wins (text-blue-500 overrides text-red-500)", () => {
      expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    });

    it("resolves margin conflict — later class wins", () => {
      expect(cn("m-2", "m-4")).toBe("m-4");
    });

    it("resolves background color conflict — last wins", () => {
      expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
    });

    it("keeps non-conflicting classes alongside resolved conflicts", () => {
      const result = cn("flex", "p-4", "p-8");
      expect(result).toContain("flex");
      expect(result).toContain("p-8");
      expect(result).not.toContain("p-4");
    });

    it("resolves conflicts even when classes come from conditional objects", () => {
      const result = cn("text-sm", { "text-lg": true });
      expect(result).toBe("text-lg");
    });

    it("does not deduplicate non-conflicting classes of different types", () => {
      const result = cn("px-4", "py-4");
      expect(result).toContain("px-4");
      expect(result).toContain("py-4");
    });
  });

  describe("real-world component class patterns", () => {
    it("handles a base + variant + state pattern", () => {
      const base = "rounded border px-4 py-2";
      const variant = "bg-blue-500 text-white";
      const active = true;
      const disabled = false;
      const result = cn(base, variant, { "opacity-50 cursor-not-allowed": disabled, "ring-2": active });
      expect(result).toContain("rounded");
      expect(result).toContain("bg-blue-500");
      expect(result).toContain("ring-2");
      expect(result).not.toContain("opacity-50");
    });

    it("can accept a single long class string", () => {
      const classes = "flex items-center justify-between rounded-lg border p-4 shadow-sm";
      expect(cn(classes)).toBe(classes);
    });
  });
});
