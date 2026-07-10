import { describe, it, expect } from "vitest";
import { getContextLimit, estimateTokens, MODEL_LIMITS, supportsPdfInput, supportsVision } from "../index.js";

describe("getContextLimit", () => {
  it("returns 190000 for claude-sonnet-4 (claude prefix)", () => {
    expect(getContextLimit("claude-sonnet-4")).toBe(190_000);
  });

  it("returns 190000 for any claude-* variant", () => {
    expect(getContextLimit("claude-opus-3")).toBe(190_000);
    expect(getContextLimit("claude-haiku-3")).toBe(190_000);
    expect(getContextLimit("claude-3-5-sonnet-20241022")).toBe(190_000);
  });

  it("returns 900000 for gemini-2.5-pro (gemini prefix)", () => {
    expect(getContextLimit("gemini-2.5-pro")).toBe(900_000);
  });

  it("returns 900000 for any gemini-* variant", () => {
    expect(getContextLimit("gemini-1.5-flash")).toBe(900_000);
    expect(getContextLimit("gemini-2.0-flash")).toBe(900_000);
  });

  it("returns 120000 for gpt-5-mini (gpt-5 prefix)", () => {
    expect(getContextLimit("gpt-5-mini")).toBe(120_000);
  });

  it("returns 120000 for gpt-4o variants", () => {
    expect(getContextLimit("gpt-4o")).toBe(120_000);
    expect(getContextLimit("gpt-4o-mini")).toBe(120_000);
  });

  it("returns 190000 for o3-mini (o3 prefix)", () => {
    expect(getContextLimit("o3-mini")).toBe(190_000);
  });

  it("returns 190000 for o4 variants", () => {
    expect(getContextLimit("o4")).toBe(190_000);
    expect(getContextLimit("o4-mini")).toBe(190_000);
  });

  it("returns 120000 for o1 variants", () => {
    expect(getContextLimit("o1")).toBe(120_000);
    expect(getContextLimit("o1-preview")).toBe(120_000);
  });

  it("returns 120000 for gpt-4-turbo", () => {
    expect(getContextLimit("gpt-4-turbo")).toBe(120_000);
    expect(getContextLimit("gpt-4-turbo-preview")).toBe(120_000);
  });

  it("returns default 120000 for unknown model", () => {
    expect(getContextLimit("unknown-model")).toBe(120_000);
    expect(getContextLimit("llama-3-70b")).toBe(120_000);
    expect(getContextLimit("mistral-7b")).toBe(120_000);
    expect(getContextLimit("")).toBe(120_000);
  });

  it("MODEL_LIMITS contains expected keys", () => {
    expect(MODEL_LIMITS).toHaveProperty("claude");
    expect(MODEL_LIMITS).toHaveProperty("gemini");
    expect(MODEL_LIMITS).toHaveProperty("gpt-5");
    expect(MODEL_LIMITS).toHaveProperty("o3");
    expect(MODEL_LIMITS).toHaveProperty("o4");
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null-ish falsy input", () => {
    // The function checks `if (!text)` so null/undefined would also return 0
    // but TypeScript signature is string — test with empty string edge cases
    expect(estimateTokens("")).toBe(0);
  });

  it("returns a positive integer for short text", () => {
    const result = estimateTokens("Hello, world!");
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("returns more tokens for longer text than shorter text", () => {
    const short = estimateTokens("Hello");
    const long = estimateTokens("Hello, this is a much longer piece of text that should result in more tokens being counted.");
    expect(long).toBeGreaterThan(short);
  });

  it("returns more tokens for a paragraph than a word", () => {
    const word = estimateTokens("cat");
    const paragraph = estimateTokens(
      "The quick brown fox jumps over the lazy dog. " +
      "This is a classic pangram that contains every letter of the English alphabet. " +
      "It is often used to test fonts and keyboards."
    );
    expect(paragraph).toBeGreaterThan(word);
  });

  it("handles text with special characters", () => {
    const result = estimateTokens("Hello! @#$%^&*() 123 こんにちは");
    expect(result).toBeGreaterThan(0);
  });

  it("handles whitespace-only string", () => {
    // Whitespace is truthy so it goes through encoding
    const result = estimateTokens("   ");
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("longer code string produces more tokens than shorter code string", () => {
    const snippet = estimateTokens("const x = 1;");
    const file = estimateTokens(
      "const x = 1;\nconst y = 2;\nfunction add(a: number, b: number): number {\n  return a + b;\n}\nexport { add };"
    );
    expect(file).toBeGreaterThan(snippet);
  });
});

describe("supportsVision", () => {
  it("recognises current vision-capable families", () => {
    for (const m of [
      "claude-opus-4-8", "claude-3-5-sonnet", "gpt-4o", "gpt-4.1-mini",
      "gemini-2.0-flash", "pixtral-12b", "qwen2.5-vl-7b", "llama-3.2-11b-vision",
    ]) {
      expect(supportsVision(m)).toBe(true);
    }
  });

  it("returns false for text-only / unknown models (safe default)", () => {
    for (const m of ["deepseek-chat", "gpt-3.5-turbo", "mistral-7b", "some-unknown-model", "llama-3.2-3b-instruct"]) {
      expect(supportsVision(m)).toBe(false);
    }
  });
});

describe("supportsPdfInput", () => {
  it("recognises families with native PDF input", () => {
    for (const m of ["claude-opus-4-8", "claude-3-5-sonnet", "claude-fable-5", "gemini-2.0-flash", "anthropic/claude-sonnet-5"]) {
      expect(supportsPdfInput(m)).toBe(true);
    }
  });

  it("returns false for everything else — they get extracted text instead", () => {
    for (const m of ["gpt-4o", "gpt-5", "mistral-7b", "some-unknown-model"]) {
      expect(supportsPdfInput(m)).toBe(false);
    }
  });
});
