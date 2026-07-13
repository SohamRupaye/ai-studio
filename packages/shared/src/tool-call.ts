// Tool-call display helpers — shared between main (persist time) and the
// renderer (live tool_start/tool_end events) so a row reads identically
// while streaming and after reopen.

/** Persisted/live caps for the user-facing detail panel. Distinct from the
 * model-facing trail previews (argsPreview/resultPreview — see withToolTrail
 * in prompt-engine), which stay small because they ride the hot window. */
export const TOOL_SUMMARY_MAX = 200;
export const TOOL_ARGS_MAX = 4000;
export const TOOL_RESULT_MAX = 6000;

/** Clip with a visible marker — never silently truncate. */
export function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated]` : text;
}

/** The one argument a human actually wants on the row, per tool. */
const SALIENT_ARG: Record<string, string> = {
  bash: "command",
  web_search: "query",
  web_fetch: "url",
  read_file: "path",
  write_file: "path",
  edit_file: "path",
  apply_patch: "path",
  list_files: "path",
  glob: "pattern",
  grep: "pattern",
  remember: "content",
  skill: "name",
  subagent: "task",
  delegate: "task",
  think: "reasoning",
};

/** Fallback keys for tools we don't know (MCP servers, custom tools) — the
 * first non-empty string among these usually names what the call is about. */
const PREFERRED_KEYS = [
  "url", "query", "q", "path", "file_path", "title", "name", "prompt",
  "command", "task", "question", "text", "content", "id", "page_id",
];

function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : `${text.slice(0, nl)} …`;
}

/**
 * One-line, human-salient summary of a tool call's arguments: the bash
 * command, the fetched URL, the search query — not JSON. Falls back to
 * compact JSON when no single argument carries the meaning.
 */
export function toolCallSummary(name: string, args: Record<string, unknown>): string | undefined {
  try {
    const salient = args[SALIENT_ARG[name] ?? ""];
    if (typeof salient === "string" && salient.trim()) {
      return clip(firstLine(salient.trim()));
    }
    // kb_* tools all take a query-ish first string; MCP tools are
    // server-named (`notion_notion-search`) — same heuristic serves both.
    for (const key of PREFERRED_KEYS) {
      const v = args[key];
      if (typeof v === "string" && v.trim()) return clip(firstLine(v.trim()));
    }
    const json = JSON.stringify(args);
    if (!json || json === "{}") return undefined;
    return clip(json);
  } catch {
    return undefined;
  }
}

function clip(text: string): string {
  return text.length > TOOL_SUMMARY_MAX ? `${text.slice(0, TOOL_SUMMARY_MAX)}…` : text;
}

/** Full args for the detail panel: pretty JSON, capped with a marker. A
 * single-string-arg call (bash, think) shows the string itself — the JSON
 * wrapper adds nothing over the raw command/reasoning. */
export function toolCallArgsDetail(name: string, args: Record<string, unknown>): string | undefined {
  try {
    const keys = Object.keys(args);
    if (keys.length === 0) return undefined;
    if (keys.length === 1 && typeof args[keys[0]!] === "string") {
      return clipText(args[keys[0]!] as string, TOOL_ARGS_MAX);
    }
    return clipText(JSON.stringify(args, null, 2), TOOL_ARGS_MAX);
  } catch {
    return undefined;
  }
}

/** Tool result for the detail panel, capped with a marker. */
export function toolCallResultDetail(result: string): string | undefined {
  if (!result) return undefined;
  return clipText(result, TOOL_RESULT_MAX);
}
