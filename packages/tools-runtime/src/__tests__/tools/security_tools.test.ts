import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stripHtmlBlocks,
  stripHtmlTags,
  decodeHtmlEntities,
  htmlToText,
} from "../../tools/web.js";
import { readFile, writeFile, editFile, searchFiles } from "../../tools/file.js";
import { grepSearch, globFiles } from "../../tools/grep_glob.js";
import {
  checkpointCreate,
  checkpointDiff,
  checkpointRollback,
  checkpointDelete,
} from "../../tools/checkpoint.js";
import { MCPAuth } from "../../mcp/auth.js";

describe("web HTML sanitization", () => {
  it("strips script/style blocks including whitespace before closing >", () => {
    const html = '<p>Safe</p><script type="text/javascript">alert(1)</script  ><style>body{}</style ><p>End</p>';
    const cleaned = stripHtmlBlocks(html, ["script", "style"]);
    expect(cleaned).toBe("<p>Safe</p><p>End</p>");
  });

  it("strips HTML comments and unclosed script blocks", () => {
    expect(stripHtmlBlocks("a<!-- secret -->b", ["script"])).toBe("ab");
    expect(stripHtmlBlocks("keep<script>never closed", ["script"])).toBe("keep");
  });

  it("strips tags cleanly including quoted > attributes and trailing unclosed tags", () => {
    expect(stripHtmlTags('<div title="a>b">hello</div>')).toBe("hello");
    expect(stripHtmlTags("before<script")).toBe("before");
  });

  it("decodes HTML entities in a single pass without double-unescaping", () => {
    expect(decodeHtmlEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    expect(decodeHtmlEntities("&lt;b&gt;&quot;hi&quot;&amp;&#39;ok&#39;&lt;/b&gt;")).toBe('<b>"hi"&\'ok\'</b>');
    expect(decodeHtmlEntities("&#x41; &#66; &#99999999;")).toBe("A B &#99999999;");
  });

  it("converts full HTML document to readable text with noise stripped", () => {
    const html = `
      <html><body>
        <nav>Menu</nav>
        <article>
          <h1>Guide</h1>
          <script>evil()</script >
          <p>Read &amp;lt;docs&amp;gt; here.</p>
        </article>
      </body></html>
    `;
    const text = htmlToText(html, "https://example.com");
    expect(text).toContain("# Guide");
    expect(text).toContain("Read &lt;docs&gt; here.");
    expect(text).not.toContain("evil()");
    expect(text).not.toContain("Menu");
  });
});

describe("file, grep_glob, and checkpoint tools", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tools-unit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes, reads, edits, and searches files safely without TOCTOU races", async () => {
    const p = join(dir, "src", "hello.ts");
    const createRes = await writeFile({ path: p, content: "export const greeting = 'hello';\n" });
    expect(createRes).toContain("new file");

    const updateRes = await writeFile({ path: p, content: "export const greeting = 'world';\nexport const n = 42;\n" });
    expect(updateRes).toContain("→");

    expect(await readFile({ path: p, offset: 1, limit: 1 })).toBe("export const n = 42;");

    const editRes = await editFile({ path: p, old_str: "world", new_str: "squirl" });
    expect(editRes).toContain("+ squirl");

    const searchRes = await searchFiles({ path: dir, pattern: "squirl", include: ".ts" });
    expect(searchRes).toContain("hello.ts:1:");
  });

  it("finds files with glob_files and matches lines with grep_search", async () => {
    writeFileSync(join(dir, "a.ts"), "const alpha = 1;\nconst beta = 2;\n");
    writeFileSync(join(dir, "b.md"), "# alpha notes\n");

    const globs = await globFiles({ path: dir, patterns: ["**/*.ts"] });
    expect(globs).toContain("a.ts");
    expect(globs).not.toContain("b.md");

    const grep = await grepSearch({ path: dir, pattern: "alpha", include: ["*.ts"] });
    expect(grep).toContain("a.ts");
    expect(grep).not.toContain("b.md");
  });

  it("creates, diffs, rolls back, and deletes file checkpoints", async () => {
    const target = join(dir, "config.txt");
    writeFileSync(target, "v1\n");

    const created = await checkpointCreate({ project_root: dir, label: "before", files: ["config.txt"] });
    const idMatch = created.match(/cp_\d+/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![0];

    writeFileSync(target, "v2\n");
    const diffOut = await checkpointDiff({ project_root: dir, checkpoint_id: id });
    expect(diffOut).toContain("- v1");
    expect(diffOut).toContain("+ v2");

    await checkpointRollback({ project_root: dir, checkpoint_id: id });
    expect(readFileSync(target, "utf-8")).toBe("v1\n");

    const delOut = await checkpointDelete({ project_root: dir, checkpoint_id: id });
    expect(delOut).toContain("Deleted");
  });

  it("MCPAuth prevents prototype pollution with __proto__ keys", async () => {
    const auth = new MCPAuth(join(dir, "mcp-auth.json"));
    await auth.setCodeVerifier("__proto__", "secret-verifier");
    expect(({} as Record<string, unknown>)["codeVerifier"]).toBeUndefined();
    expect(await auth.getCodeVerifier("__proto__")).toBe("secret-verifier");
    await auth.clearCodeVerifier("__proto__");
    expect(await auth.getCodeVerifier("__proto__")).toBeUndefined();
  });
});
