/**
 * code_context.ts — Tree-sitter based code-aware context extraction.
 * Extracts symbols (functions, classes, methods) and provides focused context.
 */

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

export const LANG_MAP: Record<string, string> = {
  ".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "typescript",
  ".go": "go", ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp",
  ".h": "c", ".hpp": "cpp", ".rb": "ruby",
};

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "method" | "import";
  startLine: number;
  endLine: number;
  signature: string;
  body: string;
}

let Parser: any = null;

async function getParser(_lang: string): Promise<any> {
  // web-tree-sitter requires .wasm grammar files per language.
  // For portability, we use regex-based extraction as primary.
  // Tree-sitter can be enabled later by loading wasm grammars.
  return null;
}

interface ParseState {
  inString: string | null;
  inComment: boolean;
}

function countBracesJS(line: string, state: ParseState): number {
  let braces = 0;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    const next = line[i + 1];

    if (state.inComment) {
      if (char === "*" && next === "/") {
        state.inComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (state.inString) {
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === state.inString) {
        state.inString = null;
      }
      i++;
      continue;
    }

    if (char === "/" && next === "/") {
      break;
    }
    if (char === "/" && next === "*") {
      state.inComment = true;
      i += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      state.inString = char;
      i++;
      continue;
    }

    if (char === "{") {
      braces++;
    } else if (char === "}") {
      braces--;
    }
    i++;
  }
  return braces;
}

/** Regex-based symbol extraction (works without tree-sitter wasm files). */
function extractSymbolsRegex(source: string, lang: string): CodeSymbol[] {
  const lines = source.split("\n");
  const symbols: CodeSymbol[] = [];

  if (lang === "python") {
    const pattern = /^(\s*)(class |def |async def )(\w+)/;
    let i = 0;
    while (i < lines.length) {
      const m = lines[i]!.match(pattern);
      if (m) {
        const indent = m[1]!.length;
        const kind = m[2]!.includes("class") ? "class" : "function";
        const name = m[3]!;
        const start = i;
        let end = i + 1;
        while (end < lines.length) {
          const trimmed = lines[end]!.trim();
          if (trimmed === "" || trimmed.startsWith("#")) {
            end++;
            continue;
          }
          if (getIndent(lines[end]!) <= indent) {
            break;
          }
          end++;
        }
        end = Math.max(start, end - 1);
        symbols.push({ name, kind: kind as any, startLine: start, endLine: end, signature: lines[start]!.trim(), body: lines.slice(start, end + 1).join("\n") });
        i = end + 1;
      } else { i++; }
    }
  } else if (lang === "typescript" || lang === "javascript") {
    const pattern = /^(\s*)(?:export\s+)?(?:async\s+)?(?:function|class)\s+(\w+)|^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/;
    let i = 0;
    while (i < lines.length) {
      const m = lines[i]!.match(pattern);
      if (m) {
        const name = m[2] || m[4] || "";
        const kind = lines[i]!.includes("class") ? "class" : "function";
        const start = i;
        let braces = 0, started = false, end = i;
        const state: ParseState = { inString: null, inComment: false };
        while (end < lines.length) {
          braces += countBracesJS(lines[end]!, state);
          if (braces > 0) started = true;
          if (started && braces <= 0) break;
          end++;
        }
        if (name) {
          symbols.push({ name, kind: kind as any, startLine: start, endLine: end, signature: lines[start]!.trim(), body: lines.slice(start, end + 1).join("\n") });
        }
        i = end + 1;
      } else { i++; }
    }
  } else if (lang === "go") {
    const pattern = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/;
    let i = 0;
    while (i < lines.length) {
      const m = lines[i]!.match(pattern);
      if (m) {
        const name = m[1]!;
        const start = i;
        let braces = 0, started = false, end = i;
        const state: ParseState = { inString: null, inComment: false };
        while (end < lines.length) {
          braces += countBracesJS(lines[end]!, state);
          if (braces > 0) started = true;
          if (started && braces <= 0) break;
          end++;
        }
        symbols.push({ name, kind: "function", startLine: start, endLine: end, signature: lines[start]!.trim(), body: lines.slice(start, end + 1).join("\n") });
        i = end + 1;
      } else { i++; }
    }
  } else if (lang === "rust") {
    const pattern = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)|^(?:pub\s+)?struct\s+(\w+)|^impl\s+(\w+)/;
    let i = 0;
    while (i < lines.length) {
      const m = lines[i]!.match(pattern);
      if (m) {
        const name = m[1] || m[2] || m[3] || "";
        const kind = m[2] ? "class" : "function";
        const start = i;
        let braces = 0, started = false, end = i;
        const state: ParseState = { inString: null, inComment: false };
        while (end < lines.length) {
          braces += countBracesJS(lines[end]!, state);
          if (braces > 0) started = true;
          if (started && braces <= 0) break;
          end++;
        }
        if (name) symbols.push({ name, kind: kind as any, startLine: start, endLine: end, signature: lines[start]!.trim(), body: lines.slice(start, end + 1).join("\n") });
        i = end + 1;
      } else { i++; }
    }
  }

  return symbols;
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

/** Extract code symbols from a file. */
export function extractSymbols(filePath: string): CodeSymbol[] {
  if (!existsSync(filePath)) return [];
  const ext = extname(filePath).toLowerCase();
  const lang = LANG_MAP[ext];
  if (!lang) return [];
  const source = readFileSync(filePath, "utf-8");
  return extractSymbolsRegex(source, lang);
}

/** Extract only the code symbols relevant to a query from a file. */
export function getRelevantContext(filePath: string, query: string, maxTokens = 2000): string {
  const symbols = extractSymbols(filePath);
  if (!symbols.length) {
    if (!existsSync(filePath)) return "";
    const content = readFileSync(filePath, "utf-8");
    return content.slice(0, maxTokens * 4);
  }

  const queryLower = query.toLowerCase();
  const scored: Array<[number, CodeSymbol]> = symbols.map(sym => {
    let score = 0;
    if (queryLower.includes(sym.name.toLowerCase())) score += 10;
    if (query.split(/\s+/).some(w => w.length > 2 && sym.name.toLowerCase().includes(w.toLowerCase()))) score += 5;
    if (sym.kind === "class") score += 2;
    if (sym.kind === "import") score += 1;
    return [score, sym];
  });

  scored.sort((a, b) => b[0] - a[0] || a[1].startLine - b[1].startLine);

  const parts: string[] = [];
  let tokensUsed = 0;
  for (const [score, sym] of scored) {
    const symTokens = Math.ceil(sym.body.length / 4);
    if (tokensUsed + symTokens > maxTokens) {
      if (score > 0) { parts.push(`# ${sym.signature}  (lines ${sym.startLine}-${sym.endLine})`); tokensUsed += Math.ceil(sym.signature.length / 4); }
      continue;
    }
    parts.push(sym.body);
    tokensUsed += symTokens;
    if (tokensUsed >= maxTokens) break;
  }

  return parts.join("\n\n") || readFileSync(filePath, "utf-8").slice(0, maxTokens * 4);
}
