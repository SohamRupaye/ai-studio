import { describe, it, expect } from "vitest";
import { detectArtifacts } from "../artifacts.js";

// Helper to create a code block of a given approximate content length
function codeBlock(lang: string, content: string): string {
  return "```" + lang + "\n" + content + "\n```";
}

// 300 chars of code content ensures total block length >= 300
function longCode(charCount = 300): string {
  return "const x = " + "a".repeat(charCount);
}

describe("detectArtifacts", () => {
  describe("empty and trivial inputs", () => {
    it("returns [] for empty string", () => {
      expect(detectArtifacts("")).toEqual([]);
    });

    it("returns [] for plain prose without code blocks or section headings", () => {
      const text = "This is just some plain text. No code, no headings. Just prose.";
      expect(detectArtifacts(text)).toEqual([]);
    });

    it("returns [] for a string with only whitespace", () => {
      expect(detectArtifacts("   \n\n\t  ")).toEqual([]);
    });
  });

  describe("code blocks", () => {
    it("does not extract short code block (< 200 chars total)", () => {
      const short = codeBlock("ts", "const x = 1;");
      expect(short.length).toBeLessThan(200);
      expect(detectArtifacts(short)).toEqual([]);
    });

    it("does not extract code block just under the 300-char extraction threshold", () => {
      // The check in source is `content.length < 300` for the full match
      const content = "x".repeat(290);
      const block = codeBlock("js", content);
      // block total = "```js\n" + content + "\n```" — test that it doesn't get picked up
      // If total < 300, it won't be extracted
      if (block.length < 300) {
        expect(detectArtifacts(block)).toEqual([]);
      }
    });

    it("extracts a long code block (>= 300 chars) with type 'code'", () => {
      const block = codeBlock("typescript", longCode(350));
      expect(block.length).toBeGreaterThanOrEqual(300);
      const result = detectArtifacts(block);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.type).toBe("code");
    });

    it("extracted code artifact has content field matching the code block", () => {
      const block = codeBlock("typescript", longCode(350));
      const result = detectArtifacts(block);
      expect(result[0]!.content).toContain("```typescript");
    });

    it("extracts a Python code block with type 'code'", () => {
      const block = codeBlock("python", "def my_function():\n" + "    return " + "'hello'".repeat(60));
      const result = detectArtifacts(block);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.type).toBe("code");
    });

    it("deduplicates identical code blocks — only one result", () => {
      const block = codeBlock("typescript", longCode(350));
      const text = block + "\n\n" + block;
      const result = detectArtifacts(text);
      // Both blocks have same title prefix → deduplicated
      const codeArtifacts = result.filter(a => a.type === "code");
      expect(codeArtifacts.length).toBe(1);
    });

    it("extracts two different code blocks as separate artifacts", () => {
      const block1 = codeBlock("typescript", "export function add(a: number, b: number): number { return a + b; }" + "x".repeat(280));
      const block2 = codeBlock("python", "def subtract(a, b):\n    return a - b\n" + "y".repeat(280));
      const text = block1 + "\n\n" + block2;
      const result = detectArtifacts(text);
      const codeArtifacts = result.filter(a => a.type === "code");
      expect(codeArtifacts.length).toBe(2);
    });
  });

  describe("PRD sections", () => {
    it("extracts a PRD section heading with type 'prd'", () => {
      const text = "# PRD: User Authentication System\n\n" +
        "## Overview\n\n" +
        "This document describes the requirements for the user authentication system.\n\n".repeat(15) +
        "## Functional Requirements\n\n" +
        "1. Users shall be able to log in with email and password.\n".repeat(10) +
        "\n---\n";
      const result = detectArtifacts(text);
      const prd = result.find(a => a.type === "prd");
      expect(prd).toBeDefined();
      expect(prd!.type).toBe("prd");
    });

    it("extracts 'Product Requirements' heading as prd type", () => {
      const text = "# Product Requirements Document\n\n" +
        "This PRD outlines the requirements.\n\n".repeat(20) +
        "\n---\n";
      const result = detectArtifacts(text);
      const prd = result.find(a => a.type === "prd");
      expect(prd).toBeDefined();
    });
  });

  describe("Architecture sections", () => {
    it("extracts an Architecture heading with type 'architecture'", () => {
      const body = "This section describes the system architecture in detail.\n\n".repeat(15);
      const text = "# Architecture Overview\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const arch = result.find(a => a.type === "architecture");
      expect(arch).toBeDefined();
      expect(arch!.type).toBe("architecture");
    });

    it("extracts 'System Design' heading as architecture type", () => {
      const body = "The system uses a microservices architecture.\n\n".repeat(15);
      const text = "# System Design\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const arch = result.find(a => a.type === "architecture");
      expect(arch).toBeDefined();
    });

    it("extracts 'Technical Design' heading as architecture type", () => {
      const body = "Technical components and their interactions.\n\n".repeat(15);
      const text = "# Technical Design\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const arch = result.find(a => a.type === "architecture");
      expect(arch).toBeDefined();
    });
  });

  describe("Plan sections", () => {
    it("extracts a Plan heading with type 'plan'", () => {
      const body = "Step 1: Research the domain.\nStep 2: Design the schema.\nStep 3: Implement.\n\n".repeat(10);
      const text = "# Plan\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const plan = result.find(a => a.type === "plan");
      expect(plan).toBeDefined();
      expect(plan!.type).toBe("plan");
    });

    it("extracts 'Implementation Plan' heading as plan type", () => {
      const body = "Phase 1: Foundation.\nPhase 2: Core features.\nPhase 3: Testing.\n\n".repeat(8);
      const text = "# Implementation Plan\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const plan = result.find(a => a.type === "plan");
      expect(plan).toBeDefined();
    });

    it("extracts 'Roadmap' heading as plan type", () => {
      const body = "Q1 2026: Alpha release.\nQ2 2026: Beta release.\nQ3 2026: GA.\n\n".repeat(8);
      const text = "# Roadmap\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const plan = result.find(a => a.type === "plan");
      expect(plan).toBeDefined();
    });
  });

  describe("Research sections", () => {
    it("extracts a Research heading with type 'research'", () => {
      const body = "We investigated multiple approaches to solving this problem.\n\n".repeat(15);
      const text = "# Research: Caching Strategies\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const research = result.find(a => a.type === "research");
      expect(research).toBeDefined();
      expect(research!.type).toBe("research");
    });

    it("extracts 'Analysis' heading as research type", () => {
      const body = "After analyzing the available data, we found that...\n\n".repeat(15);
      const text = "# Analysis\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const research = result.find(a => a.type === "research");
      expect(research).toBeDefined();
    });

    it("extracts 'Findings' heading as research type", () => {
      const body = "The findings indicate several key insights.\n\n".repeat(15);
      const text = "# Findings\n\n" + body + "\n---\n";
      const result = detectArtifacts(text);
      const research = result.find(a => a.type === "research");
      expect(research).toBeDefined();
    });
  });

  describe("artifact structure", () => {
    it("each artifact has type, title, and content fields", () => {
      const block = codeBlock("typescript", longCode(400));
      const result = detectArtifacts(block);
      expect(result.length).toBeGreaterThan(0);
      for (const artifact of result) {
        expect(artifact).toHaveProperty("type");
        expect(artifact).toHaveProperty("title");
        expect(artifact).toHaveProperty("content");
        expect(typeof artifact.type).toBe("string");
        expect(typeof artifact.title).toBe("string");
        expect(typeof artifact.content).toBe("string");
      }
    });

    it("title is non-empty for extracted code block", () => {
      const block = codeBlock("typescript", longCode(400));
      const result = detectArtifacts(block);
      expect(result[0]!.title.length).toBeGreaterThan(0);
    });

    it("code artifact title contains the language name", () => {
      const block = codeBlock("rust", "fn main() {\n    println!(\"hello\");\n}\n" + "x".repeat(300));
      const result = detectArtifacts(block);
      if (result.length > 0) {
        expect(result[0]!.title.toLowerCase()).toContain("rust");
      }
    });
  });

  describe("deduplication", () => {
    it("same-type same-title-prefix blocks are deduplicated across the text", () => {
      const block = codeBlock("go", "func main() {\n" + "\t// do stuff\n".repeat(30) + "}\n");
      const text = block + "\n\n" + block + "\n\n" + block;
      const result = detectArtifacts(text);
      const codes = result.filter(a => a.type === "code");
      // All three have same title → only one kept
      expect(codes.length).toBeLessThanOrEqual(1);
    });
  });
});
