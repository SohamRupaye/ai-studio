import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname, join } from "node:path";
import { getClient } from "../lsp/client.js";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";
import { extractSymbols } from "./code_context.js";

const LANG_MAP_LSP: Record<string, boolean> = { ".ts": true, ".tsx": true, ".js": true, ".py": true, ".rs": true, ".go": true };
const SKIP_LSP = new Set(["node_modules", ".git", "dist", "build", ".next"]);

function resolveSymbolLocation(root: string, symbol: string): { file: string; line: number; col: number } | null {
  let fileCount = 0;

  function walk(dir: string): { file: string; line: number; col: number } | null {
    if (fileCount > 300) return null;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return null; }

    for (const entry of entries) {
      if (SKIP_LSP.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        const found = walk(full);
        if (found) return found;
        continue;
      }
      if (!LANG_MAP_LSP[extname(full).toLowerCase()]) continue;
      if (stat.size > 200_000) continue;
      fileCount++;

      const syms = extractSymbols(full);
      for (const s of syms) {
        if (s.name === symbol) {
          const col = s.signature.indexOf(symbol);
          return { file: full, line: s.startLine, col: col >= 0 ? col : 0 };
        }
      }
    }
    return null;
  }

  return walk(root);
}

export const lspDiagnosticsDef: ToolDefinition = {
  name: "lsp_diagnostics",
  description: "Get real-time compiler/linter diagnostics for a file via the language server. Returns errors, warnings, and hints with line numbers.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "File path to analyze" },
      project_root: { type: "string", description: "Project root (default: cwd)" },
    },
    required: ["file"],
  },
};

export const lspDiagnostics: ToolHandler = async (args) => {
  const filePath = resolve(args["file"] as string);
  const root = (args["project_root"] as string) || process.cwd();

  if (!existsSync(filePath)) return `File not found: ${filePath}`;

  const content = readFileSync(filePath, "utf-8");
  const client = await getClient(root);
  const started = await client?.openFile(filePath);

  if (!started) {
    return `No LSP server available for ${extname(filePath)} files. Install the appropriate language server.`;
  }

  const diags = await client?.getDiagnostics(filePath) ?? [];
  if (!diags.length) return `No diagnostics found for ${relative(root, filePath)}`;

  const lines = [`Diagnostics for ${relative(root, filePath)} (${diags.length} issues):\n`];
  const byKind: Record<number, typeof diags> = {};
  for (const d of diags) (byKind[d.severity ?? 1] ??= []).push(d);

  const severityMap: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
  for (const sev of [1, 2, 3, 4]) {
    const group = byKind[sev];
    if (!group?.length) continue;
    const name = severityMap[sev] ?? "info";
    const icon = sev === 1 ? "X" : sev === 2 ? "!" : "i";
    lines.push(`${icon} ${name.toUpperCase()} (${group.length}):`);
    for (const d of group) {
      lines.push(`  Line ${d.range.start.line + 1}: ${d.message}`);
    }
  }

  return lines.join("\n");
};

export const lspHoverDef: ToolDefinition = {
  name: "lsp_hover",
  description: "Get type information, documentation, and signature for a symbol at a specific location (LSP hover).",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string" },
      line: { type: "number", description: "Line number (1-indexed)" },
      col: { type: "number", description: "Column number (1-indexed)" },
      symbol: { type: "string", description: "Symbol name (alternative to line/col)" },
      project_root: { type: "string" },
    },
    required: ["file"],
  },
};

export const lspHover: ToolHandler = async (args) => {
  const filePath = resolve(args["file"] as string);
  const root = (args["project_root"] as string) || process.cwd();
  const symbol = args["symbol"] as string | undefined;

  if (!existsSync(filePath)) return `File not found: ${filePath}`;

  let line = ((args["line"] as number) || 1) - 1;
  let col = ((args["col"] as number) || 1) - 1;

  if (symbol) {
    const content = readFileSync(filePath, "utf-8").split("\n");
    for (let i = 0; i < content.length; i++) {
      const idx = content[i]!.indexOf(symbol);
      if (idx >= 0) { line = i; col = idx; break; }
    }
  }

  const client = await getClient(root);
  const started = await client?.openFile(filePath);
  if (!started) return `No LSP server available for ${extname(filePath)} files.`;

  const hover = await client?.hover(filePath, line, col);
  if (!hover) return `No hover info available at line ${line + 1}, col ${col + 1}.`;
  return `Hover info at ${relative(root, filePath)}:${line + 1}:${col + 1}:\n\n${hover}`;
};

export const lspRenameDef: ToolDefinition = {
  name: "lsp_rename",
  description: "Rename a symbol across the entire project using the language server. Use apply=true to write changes.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      new_name: { type: "string" },
      file: { type: "string" },
      apply: { type: "boolean", description: "Write changes (default: false — preview only)" },
      project_root: { type: "string" },
    },
    required: ["symbol", "new_name"],
  },
};

export const lspRename: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const symbol = args["symbol"] as string;
  const newName = args["new_name"] as string;
  const apply = args["apply"] as boolean | undefined;

  let targetFile = args["file"] as string | undefined;
  let line = 0, col = 0;

  if (targetFile) {
    targetFile = resolve(targetFile);
    const content = readFileSync(targetFile, "utf-8").split("\n");
    for (let i = 0; i < content.length; i++) {
      const idx = content[i]!.indexOf(symbol);
      if (idx >= 0) { line = i; col = idx; break; }
    }
  } else {
    const loc = resolveSymbolLocation(root, symbol);
    if (!loc) return `Could not locate symbol '${symbol}' in project.`;
    targetFile = loc.file;
    line = loc.line;
    col = loc.col;
  }

  const client = await getClient(root);
  const started = await client?.openFile(targetFile);
  if (!started) return `No LSP server available. Cannot perform semantic rename.`;

  const result = await (client as any).rename?.(targetFile, line, col, newName);
  if (!result) return `LSP rename returned no changes for '${symbol}'.`;

  const { writeFileSync } = await import("node:fs");
  const changes: string[] = [`Rename '${symbol}' -> '${newName}':`];
  let totalEdits = 0;

  const documentChanges = result.documentChanges || Object.entries(result.changes || {}).map(([uri, edits]) => ({ textDocument: { uri }, edits }));

  for (const docChange of documentChanges) {
    const uri: string = docChange.textDocument?.uri || docChange.uri;
    const edits: any[] = docChange.edits || [];
    const filePath = uri.replace("file://", "");
    const relPath = relative(root, filePath);

    changes.push(`  ${relPath} — ${edits.length} change(s)`);
    totalEdits += edits.length;

    if (apply) {
      try {
        const fileLines = readFileSync(filePath, "utf-8").split("\n");
        const sorted = [...edits].sort((a, b) =>
          b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character
        );
        for (const edit of sorted) {
          const startL = edit.range.start.line;
          const startC = edit.range.start.character;
          const endL = edit.range.end.line;
          const endC = edit.range.end.character;
          if (startL === endL) {
            const l = fileLines[startL] || "";
            fileLines[startL] = l.slice(0, startC) + edit.newText + l.slice(endC);
          } else {
            const before = (fileLines[startL] || "").slice(0, startC);
            const after = (fileLines[endL] || "").slice(endC);
            fileLines.splice(startL, endL - startL + 1, before + edit.newText + after);
          }
        }
        writeFileSync(filePath, fileLines.join("\n"), "utf-8");
        changes[changes.length - 1] += " written";
      } catch {
        // File disappeared or unreadable
      }
    }
  }

  changes.push(`\nTotal: ${totalEdits} edit(s) across ${documentChanges.length} file(s).`);
  if (!apply) changes.push("\nPreview only. Pass apply=true to write changes.");

  return changes.join("\n");
};

export const lspImplementationsDef: ToolDefinition = {
  name: "lsp_implementations",
  description: "Find all implementations of an interface or abstract class method using the language server.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      file: { type: "string" },
      project_root: { type: "string" },
    },
    required: ["symbol"],
  },
};

export const lspImplementations: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const symbol = args["symbol"] as string;

  let targetFile = args["file"] as string | undefined;
  let line = 0, col = 0;

  if (targetFile) {
    targetFile = resolve(targetFile);
    const content = readFileSync(targetFile, "utf-8").split("\n");
    for (let i = 0; i < content.length; i++) {
      const idx = content[i]!.indexOf(symbol);
      if (idx >= 0) { line = i; col = idx; break; }
    }
  } else {
    const loc = resolveSymbolLocation(root, symbol);
    if (!loc) return `Could not locate symbol '${symbol}' in project.`;
    targetFile = loc.file;
    line = loc.line;
    col = loc.col;
  }

  const client = await getClient(root);
  const started = await client?.openFile(targetFile);
  if (!started) return `No LSP server available for this file type.`;

  const impls = await (client as any).findImplementations?.(targetFile, line, col);
  if (!impls || !impls.length) return `No implementations found for '${symbol}'.`;

  const lines = [`Implementations of '${symbol}' (${impls.length}):\n`];
  for (const loc of impls) {
    const filePath = loc.file.replace("file://", "");
    const relPath = relative(root, filePath);
    let context = "";
    if (existsSync(filePath)) {
      const fileLines = readFileSync(filePath, "utf-8").split("\n");
      context = fileLines[loc.line]?.trim() || "";
    }
    lines.push(`  ${relPath}:${loc.line + 1}:${loc.col + 1}  ${context}`);
  }

  return lines.join("\n");
};

export const lspCodeActionsDef: ToolDefinition = {
  name: "lsp_code_actions",
  description: "Get available code actions (quick fixes, refactors) for a file at a given line via the language server.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string" },
      line: { type: "number", description: "Line number (1-indexed)" },
      apply_index: { type: "number" },
      project_root: { type: "string" },
    },
    required: ["file", "line"],
  },
};

export const lspCodeActions: ToolHandler = async (args) => {
  const filePath = resolve(args["file"] as string);
  const root = (args["project_root"] as string) || process.cwd();
  const lineNum = ((args["line"] as number) || 1) - 1;

  if (!existsSync(filePath)) return `File not found: ${filePath}`;

  const client = await getClient(root);
  const started = await client?.openFile(filePath);
  if (!started) return `No LSP server available for ${extname(filePath)} files.`;

  const actions = await (client as any).codeActions?.(filePath, lineNum);
  if (!actions || !actions.length) return `No code actions available at line ${lineNum + 1}.`;

  const lines = [`Code actions at ${relative(root, filePath)}:${lineNum + 1} (${actions.length}):\n`];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    lines.push(`  [${i}] ${a.title || a.command?.title || JSON.stringify(a)}`);
  }

  return lines.join("\n");
};
