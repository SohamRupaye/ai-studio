import { describe, it, expect } from "vitest";
import {
  toolCallSummary,
  toolCallSalient,
  toolCallArgsDetail,
  toolCallResultDetail,
  humanizeToolAction,
  humanizeServerName,
  clipText,
  TOOL_SUMMARY_MAX,
  TOOL_ARGS_MAX,
  TOOL_RESULT_MAX,
} from "../tool-call.js";

describe("toolCallSummary", () => {
  it("leads with the salient argument for known tools", () => {
    expect(toolCallSummary("bash", { command: "npm test", cwd: "/x" })).toBe("npm test");
    expect(toolCallSummary("web_fetch", { url: "https://example.com/docs", max_chars: 5 })).toBe("https://example.com/docs");
    expect(toolCallSummary("web_search", { query: "rust async runtime" })).toBe("rust async runtime");
    expect(toolCallSummary("read_file", { path: "/tmp/a.ts", limit: 10 })).toBe("/tmp/a.ts");
    expect(toolCallSummary("subagent", { task: "compare products" })).toBe("compare products");
    expect(toolCallSummary("think", { reasoning: "step one", plan: ["a"] })).toBe("step one");
  });

  it("keeps only the first line of multi-line values", () => {
    expect(toolCallSummary("bash", { command: "echo hi\necho bye" })).toBe("echo hi …");
  });

  it("uses the preferred-key heuristic for unknown (MCP) tools", () => {
    expect(toolCallSummary("notion_notion-search", { query: "projects" })).toBe("projects");
    expect(toolCallSummary("linear_create-issue", { title: "Fix login", team: "ENG" })).toBe("Fix login");
  });

  it("falls back to compact JSON when nothing salient exists", () => {
    expect(toolCallSummary("todo_write", { items: [1, 2] })).toBe('{"items":[1,2]}');
  });

  it("returns undefined for empty args", () => {
    expect(toolCallSummary("bash", {})).toBeUndefined();
  });

  it("caps long summaries", () => {
    const s = toolCallSummary("bash", { command: "x".repeat(500) })!;
    expect(s.length).toBe(TOOL_SUMMARY_MAX + 1); // +1 for the ellipsis
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("toolCallSalient", () => {
  it("returns the salient arg like toolCallSummary", () => {
    expect(toolCallSalient("bash", { command: "rm -rf build", cwd: "/x" })).toBe("rm -rf build");
    expect(toolCallSalient("notion_notion-search", { query: "projects" })).toBe("projects");
  });

  it("finds preferred keys in nested args (the create-pages shape)", () => {
    const args = {
      pages: [{ properties: { title: "Demo Test Page" }, content: "# Demo Test Page\nbody" }],
    };
    // title outranks content even though content sits shallower in the tree
    expect(toolCallSalient("notion_notion-create-pages", args)).toBe("Demo Test Page");
  });

  it("never falls back to JSON", () => {
    expect(toolCallSalient("todo_write", { items: [1, 2] })).toBeUndefined();
    expect(toolCallSalient("bash", {})).toBeUndefined();
  });

  it("stops at the depth cap", () => {
    const deep = { a: { b: { c: { d: { title: "too deep" } } } } };
    expect(toolCallSalient("x", deep)).toBeUndefined();
  });
});

describe("humanizeToolAction / humanizeServerName", () => {
  it("strips the server prefix and splits dashes", () => {
    expect(humanizeToolAction("notion-create-pages", "notion")).toBe("create pages");
    expect(humanizeToolAction("notion-fetch", "notion")).toBe("fetch");
  });

  it("handles underscores and camelCase, with or without a server", () => {
    expect(humanizeToolAction("create_issue", "linear")).toBe("create issue");
    expect(humanizeToolAction("createPage")).toBe("create page");
    expect(humanizeToolAction("web_fetch")).toBe("web fetch");
  });

  it("leaves names without the prefix intact", () => {
    expect(humanizeToolAction("update-page", "notion")).toBe("update page");
  });

  it("title-cases server ids", () => {
    expect(humanizeServerName("notion")).toBe("Notion");
    expect(humanizeServerName("google-drive")).toBe("Google Drive");
  });
});

describe("toolCallArgsDetail", () => {
  it("shows the bare string for single-string-arg calls", () => {
    expect(toolCallArgsDetail("think", { reasoning: "line 1\nline 2" })).toBe("line 1\nline 2");
  });

  it("pretty-prints multi-arg calls", () => {
    expect(toolCallArgsDetail("bash", { command: "ls", cwd: "/tmp" })).toBe(
      JSON.stringify({ command: "ls", cwd: "/tmp" }, null, 2),
    );
  });

  it("returns undefined for empty args and caps with a visible marker", () => {
    expect(toolCallArgsDetail("bash", {})).toBeUndefined();
    const detail = toolCallArgsDetail("bash", { command: "y".repeat(TOOL_ARGS_MAX + 100) })!;
    expect(detail.endsWith("… [truncated]")).toBe(true);
  });
});

describe("toolCallResultDetail / clipText", () => {
  it("passes short results through and caps long ones visibly", () => {
    expect(toolCallResultDetail("done")).toBe("done");
    expect(toolCallResultDetail("")).toBeUndefined();
    const long = toolCallResultDetail("z".repeat(TOOL_RESULT_MAX + 5))!;
    expect(long.endsWith("… [truncated]")).toBe(true);
  });

  it("clipText leaves text at the cap untouched", () => {
    expect(clipText("abc", 3)).toBe("abc");
  });
});
