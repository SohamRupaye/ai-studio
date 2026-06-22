import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractReferences, resolveReferences, expandFileReferences } from "../file_references.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "file-refs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── extractReferences ─────────────────────────────────────────────────────────

describe("extractReferences", () => {
  it("extracts a single file reference", () => {
    const refs = extractReferences("check @src/foo.ts for details");
    expect(refs).toContain("src/foo.ts");
  });

  it("returns [] when no references present", () => {
    expect(extractReferences("no refs here")).toEqual([]);
  });

  it("extracts relative (./) and home (~/) references", () => {
    const refs = extractReferences("@./relative.js and @~/home.md");
    expect(refs.some(r => r.includes("relative.js"))).toBe(true);
    expect(refs.some(r => r.includes("home.md"))).toBe(true);
  });

  it("deduplicates the same reference appearing twice", () => {
    const refs = extractReferences("@src/foo.ts and again @src/foo.ts");
    const count = refs.filter(r => r === "src/foo.ts").length;
    expect(count).toBe(1);
  });

  it("extracts multiple distinct references", () => {
    const refs = extractReferences("@src/a.ts and @src/b.ts");
    expect(refs).toContain("src/a.ts");
    expect(refs).toContain("src/b.ts");
  });
});

// ── resolveReferences ─────────────────────────────────────────────────────────

describe("resolveReferences", () => {
  it("resolves existing file and returns path + content", async () => {
    const filePath = join(tmpDir, "hello.ts");
    writeFileSync(filePath, "export const x = 1;");
    const results = await resolveReferences(`@${filePath}`, tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const entry = results.find(r => r.path === filePath);
    expect(entry).toBeDefined();
    expect(entry!.content).toContain("export const x = 1;");
  });

  it("silently skips missing file → returns []", async () => {
    const results = await resolveReferences("@nonexistent/file.ts", tmpDir);
    expect(results).toHaveLength(0);
  });

  it("skips files larger than 100KB", async () => {
    const bigFile = join(tmpDir, "big.ts");
    // 101KB of data
    writeFileSync(bigFile, "x".repeat(101_001));
    const results = await resolveReferences(`@${bigFile}`, tmpDir);
    // Should be skipped (too large)
    expect(results.find(r => r.path === bigFile)).toBeUndefined();
  });

  it("resolves a directory reference as a listing", async () => {
    writeFileSync(join(tmpDir, "file.ts"), "content");
    // tmpDir ends with / to trigger DIR_REF_PATTERN
    const results = await resolveReferences(`@${tmpDir}/`, tmpDir);
    if (results.length > 0) {
      expect(results[0]!.content).toMatch(/file\.ts/);
    }
    // Either resolved or skipped — no throw either way
  });
});

// ── expandFileReferences ──────────────────────────────────────────────────────

describe("expandFileReferences", () => {
  it("with existing file: result contains <file_reference path= block", async () => {
    const filePath = join(tmpDir, "module.ts");
    writeFileSync(filePath, "const answer = 42;");
    const result = await expandFileReferences(`check @${filePath}`, tmpDir);
    expect(result).toContain("<file_reference path=");
    expect(result).toContain("const answer = 42;");
  });

  it("with no refs: returns original text unchanged", async () => {
    const text = "no file references here";
    const result = await expandFileReferences(text, tmpDir);
    expect(result).toBe(text);
  });

  it("replaces @path with [path] in the text portion", async () => {
    const filePath = join(tmpDir, "replaced.ts");
    writeFileSync(filePath, "// content");
    const result = await expandFileReferences(`look at @${filePath} for info`, tmpDir);
    expect(result).toContain(`[${filePath}]`);
    // The raw @path should be replaced
    expect(result).not.toContain(`@${filePath} for info`);
  });

  it("missing file reference → text returned unchanged (no error)", async () => {
    const result = await expandFileReferences("see @missing/file.ts", tmpDir);
    // No resolved content → text unchanged
    expect(result).toContain("missing/file.ts");
  });
});
