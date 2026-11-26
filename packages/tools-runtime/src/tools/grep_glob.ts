/**
 * grep_glob.ts — Proper grep and glob tools.
 *
 * grep_search: ripgrep-style pattern search across files.
 *   - context lines (before/after matches)
 *   - glob include/exclude patterns
 *   - line numbers, file:line:col format
 *   - binary file skip
 *   - result cap with "N more matches" indicator
 *
 * glob_files: find files matching shell glob patterns.
 *   - supports **, *.ts, src/**\/test-*.ts etc.
 *   - exclude patterns (node_modules, dist, etc.)
 *   - returns sorted list with file sizes
 */

import { closeSync, fstatSync, openSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Shared utils ──────────────────────────────────────────────────────────────

const DEFAULT_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "__pycache__", ".venv", "venv", "target", ".tox", "coverage"]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".wasm", ".exe", ".dll", ".so", ".dylib", ".bin",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".wav", ".ogg", ".mov",
  ".ttf", ".woff", ".woff2", ".eot",
  ".map",
]);

function isBinary(path: string): boolean {
  return BINARY_EXTS.has(extname(path).toLowerCase());
}

// ── Glob matching ─────────────────────────────────────────────────────────────
// Converts a glob pattern to a RegExp.
// Supports: *, **, ?, [abc], {a,b,c}

function globToRegex(pattern: string): RegExp {
  // Normalize separators
  pattern = pattern.replace(/\\/g, "/");

  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches any path segment
        regex += ".*";
        i += 2;
        if (pattern[i] === "/") i++; // consume trailing slash
      } else {
        // * matches within a segment (no /)
        regex += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === "{") {
      // {a,b,c} → (a|b|c)
      const end = pattern.indexOf("}", i);
      if (end === -1) { regex += "\\{"; i++; continue; }
      const options = pattern.slice(i + 1, end).split(",").map(o => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      regex += `(${options})`;
      i = end + 1;
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i);
      if (end === -1) { regex += "\\["; i++; continue; }
      regex += pattern.slice(i, end + 1);
      i = end + 1;
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }

  return new RegExp(`^${regex}$`);
}

function matchesGlob(relPath: string, pattern: string): boolean {
  // Normalize to forward slashes
  const norm = relPath.replace(/\\/g, "/");

  // If pattern has no slash, match basename only
  if (!pattern.includes("/") && !pattern.includes("**/")) {
    return globToRegex(pattern).test(basename(norm));
  }
  return globToRegex(pattern).test(norm);
}

function matchesAnyGlob(relPath: string, patterns: string[]): boolean {
  return patterns.some(p => matchesGlob(relPath, p));
}

// ── Tool: grep_search ─────────────────────────────────────────────────────────

interface GrepMatch {
  file: string;
  line: number;
  col: number;
  text: string;
  before: string[];
  after: string[];
}

function grepDir(
  root: string,
  dir: string,
  pattern: RegExp,
  include: string[],
  exclude: string[],
  contextLines: number,
  maxMatches: number,
  results: GrepMatch[],
  skipped: { count: number }
) {
  if (results.length >= maxMatches) return;

  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (results.length >= maxMatches) break;
    if (DEFAULT_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;

    const full = join(dir, entry.name);
    const rel = relative(root, full).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (exclude.length && matchesAnyGlob(rel, exclude)) continue;
      grepDir(root, full, pattern, include, exclude, contextLines, maxMatches, results, skipped);
      continue;
    }
    if (!entry.isFile()) continue;

    // File filtering
    if (isBinary(full)) continue;
    if (include.length && !matchesAnyGlob(rel, include)) continue;
    if (exclude.length && matchesAnyGlob(rel, exclude)) continue;

    let content: string;
    let fd: number | undefined;
    try {
      fd = openSync(full, "r");
      if (fstatSync(fd).size > 2 * 1024 * 1024) continue; // skip >2MB
      content = readFileSync(fd, "utf-8");
    } catch {
      continue;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxMatches) { skipped.count++; continue; }

      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      const match = pattern.exec(lines[i]!);
      if (!match) { pattern.lastIndex = 0; continue; }
      pattern.lastIndex = 0;

      const before = lines.slice(Math.max(0, i - contextLines), i).map(l => l.trimEnd());
      const after = lines.slice(i + 1, i + 1 + contextLines).map(l => l.trimEnd());

      results.push({
        file: rel,
        line: i + 1,
        col: match.index + 1,
        text: lines[i]!,
        before,
        after,
      });
    }
  }
}

export const grepSearchDef: ToolDefinition = {
  name: "grep_search",
  description: "Search for a regex or literal pattern across files. Returns file:line:col matches with optional context lines. Like ripgrep — much more powerful than search_files. Supports glob include/exclude patterns.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Search pattern. Regex by default (e.g. 'function\\s+myFn'). Use fixed=true for literal strings." },
      path: { type: "string", description: "Directory to search (default: cwd)" },
      include: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to include, e.g. ['**/*.ts', '*.py']. Searches all files if omitted.",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to exclude, e.g. ['**/*.test.ts', 'dist/**']",
      },
      context_lines: { type: "number", description: "Lines of context to show before/after each match (default: 0)" },
      case_insensitive: { type: "boolean", description: "Case-insensitive search (default: false)" },
      fixed: { type: "boolean", description: "Treat pattern as a literal string, not regex (default: false)" },
      max_matches: { type: "number", description: "Max results to return (default: 100)" },
    },
    required: ["pattern"],
  },
};

export const grepSearch: ToolHandler = async (args) => {
  const root = (args["path"] as string) || process.cwd();
  const rawPattern = args["pattern"] as string;
  const include = (args["include"] as string[]) || [];
  const exclude = (args["exclude"] as string[]) || [];
  const contextLines = (args["context_lines"] as number) || 0;
  const caseInsensitive = args["case_insensitive"] as boolean | undefined;
  const fixed = args["fixed"] as boolean | undefined;
  const maxMatches = (args["max_matches"] as number) || 100;

  let pattern: RegExp;
  try {
    const escaped = fixed ? rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : rawPattern;
    pattern = new RegExp(escaped, `g${caseInsensitive ? "i" : ""}`);
  } catch (e: any) {
    return `Invalid regex pattern: ${e.message}`;
  }

  const results: GrepMatch[] = [];
  const skipped = { count: 0 };

  grepDir(root, root, pattern, include, exclude, contextLines, maxMatches, results, skipped);

  if (!results.length) return `No matches for /${rawPattern}/ in ${root}`;

  const lines: string[] = [`${results.length} match${results.length !== 1 ? "es" : ""} for /${rawPattern}/${caseInsensitive ? "i" : ""}:\n`];

  let lastFile = "";
  for (const r of results) {
    if (r.file !== lastFile) {
      lines.push(`\n📄 ${r.file}`);
      lastFile = r.file;
    }

    if (contextLines > 0 && r.before.length) {
      for (let i = 0; i < r.before.length; i++) {
        const lineNum = r.line - r.before.length + i;
        lines.push(`  ${String(lineNum).padStart(4)}  │  ${r.before[i]}`);
      }
    }

    lines.push(`  ${String(r.line).padStart(4)}  ▶  ${r.text.trim()} (col ${r.col})`);

    if (contextLines > 0 && r.after.length) {
      for (let i = 0; i < r.after.length; i++) {
        lines.push(`  ${String(r.line + 1 + i).padStart(4)}  │  ${r.after[i]}`);
      }
      if (results.indexOf(r) < results.length - 1) lines.push("  ···");
    }
  }

  if (skipped.count > 0) lines.push(`\n... ${skipped.count} more match${skipped.count !== 1 ? "es" : ""} (increase max_matches to see more)`);

  return lines.join("\n");
};

// ── Tool: glob_files ──────────────────────────────────────────────────────────

export const globFilesDef: ToolDefinition = {
  name: "glob_files",
  description: "Find files matching glob patterns (**, *.ts, src/**/*.test.ts etc). Returns sorted file paths with sizes. Much better than list_directory when you want to find specific file types or patterns.",
  parameters: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to match, e.g. ['**/*.ts', 'src/**/*.test.js']",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to exclude (defaults: node_modules/**, dist/**, .git/**)",
      },
      path: { type: "string", description: "Root directory (default: cwd)" },
      include_size: { type: "boolean", description: "Include file sizes in output (default: false)" },
      max_files: { type: "number", description: "Max files to return (default: 200)" },
    },
    required: ["patterns"],
  },
};

export const globFiles: ToolHandler = async (args) => {
  const root = (args["path"] as string) || process.cwd();
  const patterns = args["patterns"] as string[];
  const excludePatterns = (args["exclude"] as string[]) || [];
  const includeSize = args["include_size"] as boolean | undefined;
  const maxFiles = (args["max_files"] as number) || 200;

  const matches: Array<{ path: string; size: number }> = [];

  function walk(dir: string) {
    if (matches.length >= maxFiles) return;

    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (matches.length >= maxFiles) break;
      if (DEFAULT_SKIP.has(entry) || entry.startsWith(".")) continue;

      const full = join(dir, entry);
      const rel = relative(root, full).replace(/\\/g, "/");

      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        if (matchesAnyGlob(rel, excludePatterns)) continue;
        walk(full);
        continue;
      }

      if (matchesAnyGlob(rel, excludePatterns)) continue;
      if (!matchesAnyGlob(rel, patterns)) continue;

      matches.push({ path: rel, size: stat.size });
    }
  }

  walk(root);
  matches.sort((a, b) => a.path.localeCompare(b.path));

  if (!matches.length) return `No files matching [${patterns.join(", ")}] in ${root}`;

  const lines = [`Found ${matches.length} file${matches.length !== 1 ? "s" : ""}:\n`];
  for (const m of matches) {
    if (includeSize) {
      const kb = (m.size / 1024).toFixed(1);
      lines.push(`  ${m.path.padEnd(60)} ${kb}KB`);
    } else {
      lines.push(`  ${m.path}`);
    }
  }

  if (matches.length >= maxFiles) lines.push(`\n(capped at ${maxFiles} — increase max_files to see more)`);

  return lines.join("\n");
};
