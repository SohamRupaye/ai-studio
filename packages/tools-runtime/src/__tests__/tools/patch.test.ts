import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patch, patchDef } from "../../tools/patch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "patch-test-"));
});

function tmpFile(name: string, content: string): string {
  const p = join(tempDir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("patchDef", () => {
  it('name is "apply_patch"', () => {
    expect(patchDef.name).toBe("apply_patch");
  });
});

describe("patch handler", () => {
  it("applies a valid single-hunk patch and modifies the file correctly", async () => {
    const filePath = tmpFile("single.txt", "hello\nworld\nfoo\n");

    const patchText = `@@ -1,2 +1,2 @@
-hello
+goodbye
 world
`;

    const result = await patch({ path: filePath, patch: patchText });
    expect(result).toMatch(/Patched/);
    expect(result).toMatch(/1 hunk/);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("goodbye");
    expect(lines[1]).toBe("world");
    expect(lines[2]).toBe("foo");
  });

  it("applies a two-hunk patch, both hunks take effect", async () => {
    const filePath = tmpFile("two.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n");

    // Replace "alpha" in hunk 1 and "delta" in hunk 2
    const patchText = `@@ -1,1 +1,1 @@
-alpha
+ALPHA
@@ -4,1 +4,1 @@
-delta
+DELTA
`;

    const result = await patch({ path: filePath, patch: patchText });
    expect(result).toMatch(/2 hunks/);

    const lines = readFileSync(filePath, "utf-8").split("\n");
    expect(lines[0]).toBe("ALPHA");
    expect(lines[1]).toBe("beta");
    expect(lines[2]).toBe("gamma");
    expect(lines[3]).toBe("DELTA");
    expect(lines[4]).toBe("epsilon");
  });

  it("returns error for empty patch string (no hunks)", async () => {
    const filePath = tmpFile("empty.txt", "hello\nworld\n");
    const result = await patch({ path: filePath, patch: "" });
    expect(result).toBe("Error: no valid hunks found in patch");
  });

  it("returns error for patch with no @@ lines", async () => {
    const filePath = tmpFile("nohunk.txt", "hello\nworld\n");
    const result = await patch({ path: filePath, patch: "diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n" });
    expect(result).toBe("Error: no valid hunks found in patch");
  });

  it("returns context mismatch error when file content does not match patch context", async () => {
    const filePath = tmpFile("mismatch.txt", "line1\nline2\nline3\n");

    // Patch expects "wrongline" at line 1 but file has "line1"
    const patchText = `@@ -1,1 +1,1 @@
-wrongline
+replacement
`;

    const result = await patch({ path: filePath, patch: patchText });
    expect(result).toMatch(/Error: context mismatch at line/);
  });

  it("file content after patch exactly matches expected output", async () => {
    const filePath = tmpFile("verify.txt", "hello\nworld\nfoo\n");

    const patchText = `@@ -1,2 +1,2 @@
-hello
+goodbye
 world
`;

    await patch({ path: filePath, patch: patchText });

    const actual = readFileSync(filePath, "utf-8");
    // The patch replaces line 1 "hello" with "goodbye"; "world" is context (unchanged); "foo" remains
    const expected = "goodbye\nworld\nfoo\n";
    expect(actual).toBe(expected);
  });

  it("context line in patch is preserved in output", async () => {
    const filePath = tmpFile("ctx.txt", "keep\nchange\nkeep2\n");

    const patchText = `@@ -2,1 +2,1 @@
-change
+changed
`;

    await patch({ path: filePath, patch: patchText });

    const lines = readFileSync(filePath, "utf-8").split("\n");
    expect(lines[0]).toBe("keep");
    expect(lines[1]).toBe("changed");
    expect(lines[2]).toBe("keep2");
  });
});
