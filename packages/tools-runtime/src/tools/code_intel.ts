import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, resolve } from "node:path";
import { extractSymbols, LANG_MAP, type CodeSymbol } from "./code_context.js";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";
import { getClient as getLSPClient } from "../lsp/client.js";

interface SymbolEntry {
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  parent: string;
}

interface Reference {
  file: string;
  line: number;
  context: string;
  kind: "definition" | "import" | "call" | "usage";
}

interface ProjectIndex {
  root: string;
  symbols: Map<string, SymbolEntry[]>;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".tox", "target", ".next"]);
const MAX_FILES = 500;
const indexCache = new Map<string, ProjectIndex>();

function shouldIndex(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext in LANG_MAP && statSync(path).size < 100_000;
}

function buildIndex(root: string): ProjectIndex {
  const index: ProjectIndex = { root, symbols: new Map() };
  let fileCount = 0;

  function walk(dir: string) {
    if (fileCount >= MAX_FILES) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (!shouldIndex(full)) continue;
      fileCount++;

      const relPath = relative(root, full);
      const symbols = extractSymbols(full);

      for (const sym of symbols) {
        let parent = "";
        if (sym.kind === "function") {
          for (const other of symbols) {
            if (other.kind === "class" && other.startLine < sym.startLine && sym.startLine <= other.endLine) {
              parent = other.name;
              break;
            }
          }
        }
        const entry: SymbolEntry = {
          name: sym.name, kind: parent ? "method" : sym.kind,
          file: relPath, startLine: sym.startLine, endLine: sym.endLine,
          signature: sym.signature, parent,
        };
        if (!index.symbols.has(sym.name)) index.symbols.set(sym.name, []);
        index.symbols.get(sym.name)!.push(entry);
      }
    }
  }
  walk(root);
  return index;
}

function getIndex(root: string): ProjectIndex {
  if (!indexCache.has(root)) indexCache.set(root, buildIndex(root));
  return indexCache.get(root)!;
}

function findReferencesInFile(filePath: string, symbolName: string): Reference[] {
  if (!existsSync(filePath)) return [];
  const refs: Reference[] = [];
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const pattern = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i]!)) continue;
    const stripped = lines[i]!.trim();
    let kind: Reference["kind"] = "usage";
    if (/^(def |async def |class |function |fn |func )/.test(stripped) && stripped.includes(symbolName)) kind = "definition";
    else if (/^(from |import )/.test(stripped)) kind = "import";
    else if (new RegExp(`${symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(lines[i]!)) kind = "call";
    refs.push({ file: filePath, line: i + 1, context: stripped.slice(0, 120), kind });
  }
  return refs;
}

function findAllReferences(root: string, symbolName: string): Reference[] {
  const allRefs: Reference[] = [];
  let fileCount = 0;

  function walk(dir: string) {
    if (fileCount >= MAX_FILES) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (!(extname(full).toLowerCase() in LANG_MAP)) continue;
      fileCount++;
      const refs = findReferencesInFile(full, symbolName);
      for (const ref of refs) { ref.file = relative(root, ref.file); allRefs.push(ref); }
    }
  }
  walk(root);
  return allRefs;
}

function formatEntries(entries: SymbolEntry[]): string {
  return entries.map(e => {
    const parent = e.parent ? ` (method of ${e.parent})` : "";
    return `${e.kind}${parent}: ${e.file}:${e.startLine + 1}\n  ${e.signature}`;
  }).join("\n");
}

export const findDefinitionDef: ToolDefinition = {
  name: "find_definition",
  description: "Find where a symbol (function, class, method) is defined in the project.",
  parameters: { type: "object", properties: { symbol: { type: "string" }, project_root: { type: "string" } }, required: ["symbol"] },
};

export const findDefinition: ToolHandler = async (args) => {
  const symbol = args["symbol"] as string;
  const root = (args["project_root"] as string) || process.cwd();
  const index = getIndex(root);
  const searchName = symbol.includes(".") ? symbol.split(".").pop()! : symbol;
  const entries = index.symbols.get(searchName) || [];

  if (!entries.length) {
    for (const [name, ents] of index.symbols) {
      if (name.toLowerCase() === searchName.toLowerCase()) return formatEntries(ents);
    }
    return `Symbol '${symbol}' not found in project.`;
  }
  return formatEntries(entries);
};

export const findReferencesDef: ToolDefinition = {
  name: "find_references",
  description: "Find all references to a symbol across the project.",
  parameters: { type: "object", properties: { symbol: { type: "string" }, project_root: { type: "string" } }, required: ["symbol"] },
};

export const findReferences: ToolHandler = async (args) => {
  const symbol = args["symbol"] as string;
  const root = (args["project_root"] as string) || process.cwd();
  const searchName = symbol.includes(".") ? symbol.split(".").pop()! : symbol;
  const refs = findAllReferences(root, searchName);
  if (!refs.length) return `No references to '${symbol}' found.`;

  const byKind: Record<string, Reference[]> = {};
  for (const r of refs) { (byKind[r.kind] ??= []).push(r); }

  const lines = [`Found ${refs.length} references to '${symbol}':\n`];
  for (const kind of ["definition", "import", "call", "usage"] as const) {
    const group = byKind[kind];
    if (!group?.length) continue;
    lines.push(`  [${kind}] (${group.length})`);
    for (const r of group.slice(0, 10)) lines.push(`    ${r.file}:${r.line}  ${r.context}`);
    if (group.length > 10) lines.push(`    ... and ${group.length - 10} more`);
  }
  return lines.join("\n");
};

export const findCallersDef: ToolDefinition = {
  name: "find_callers",
  description: "Find all functions that call a specific function.",
  parameters: { type: "object", properties: { function_name: { type: "string" }, project_root: { type: "string" } }, required: ["function_name"] },
};

export const findCallers: ToolHandler = async (args) => {
  const name = args["function_name"] as string;
  const root = (args["project_root"] as string) || process.cwd();
  const refs = findAllReferences(root, name).filter(r => r.kind === "call");
  if (!refs.length) return `No callers of '${name}' found.`;
  const lines = [`Found ${refs.length} callers of '${name}':\n`];
  for (const r of refs.slice(0, 20)) lines.push(`  ${r.file}:${r.line}  ${r.context}`);
  if (refs.length > 20) lines.push(`  ... and ${refs.length - 20} more`);
  return lines.join("\n");
};

export const projectSymbolsDef: ToolDefinition = {
  name: "project_symbols",
  description: "List all symbols in the project. Filter by kind (function/class/method) or search by name.",
  parameters: { type: "object", properties: { project_root: { type: "string" }, kind: { type: "string" }, query: { type: "string" } }, required: [] },
};

export const projectSymbols: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const kind = args["kind"] as string | undefined;
  const query = args["query"] as string | undefined;
  const index = getIndex(root);

  const results: SymbolEntry[] = [];
  for (const [, entries] of index.symbols) {
    for (const e of entries) {
      if (kind && e.kind !== kind) continue;
      if (query && !e.name.toLowerCase().includes(query.toLowerCase())) continue;
      results.push(e);
    }
  }
  if (!results.length) return "No symbols found matching criteria.";
  results.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);

  const lines = [`Found ${results.length} symbols:\n`];
  for (const e of results.slice(0, 50)) {
    const fullName = e.parent ? `${e.parent}.${e.name}` : e.name;
    lines.push(`  ${e.kind.padEnd(8)} ${fullName.padEnd(30)} ${e.file}:${e.startLine + 1}`);
  }
  if (results.length > 50) lines.push(`  ... and ${results.length - 50} more`);
  return lines.join("\n");
};
