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
  browser_open: "url",
  browser_click: "selector",
  browser_fill: "selector",
  browser_press: "key",
  browser_scroll: "direction",
  browser_text: "selector",
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

/**
 * Salient-only variant of toolCallSummary for the approval card: a string a
 * human can weigh a trust decision on (the bash command, the page title) —
 * or nothing. Never the JSON fallback; a JSON dump on an approval prompt
 * reads as noise, not information. Searches nested args (depth-capped) so
 * shapes like {pages:[{properties:{title}}]} still surface their title,
 * picking the best PREFERRED_KEYS match across the whole tree rather than
 * the shallowest one.
 */
export function toolCallSalient(name: string, args: Record<string, unknown>): string | undefined {
  try {
    const direct = args[SALIENT_ARG[name] ?? ""];
    if (typeof direct === "string" && direct.trim()) return clip(firstLine(direct.trim()));
    const found = new Map<string, string>();
    collectPreferred(args, 3, found);
    for (const key of PREFERRED_KEYS) {
      const v = found.get(key);
      if (v) return clip(firstLine(v));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function collectPreferred(value: unknown, depth: number, out: Map<string, string>) {
  if (!value || typeof value !== "object" || depth < 0) return;
  if (!Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string" && v.trim() && PREFERRED_KEYS.includes(k) && !out.has(k)) {
        out.set(k, v.trim());
      }
    }
  }
  for (const v of Object.values(value)) collectPreferred(v, depth - 1, out);
}

/**
 * "notion-create-pages" (server "notion") → "create pages". Strips the
 * server's own name prefix (Notion's tools all start "notion-"), then splits
 * -/_/. and camelCase into lowercase words — mid-sentence prose, so the
 * caller controls capitalization.
 */
export function humanizeToolAction(raw: string, server?: string): string {
  let s = raw;
  if (server) {
    const prefix = new RegExp(`^${escapeRegExp(server)}[-_.]`, "i");
    s = s.replace(prefix, "");
  }
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_.\s]+/)
    .filter(Boolean);
  return words.join(" ").toLowerCase() || raw;
}

/** "google-drive" → "Google Drive" — display name for an MCP server id. */
export function humanizeServerName(server: string): string {
  return server
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
