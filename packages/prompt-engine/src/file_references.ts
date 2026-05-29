/**
 * File References - Parse @filepath in user messages and resolve to file content
 * Supports: @path/to/file, @./relative, @~/home-relative
 * Resolves paths relative to project root, inlines content as context blocks
 */
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";

export interface ResolvedReference {
  path: string;
  content: string;
  language?: string;
}

const FILE_REF_PATTERN = /@((?:~\/|\.\/|\.\.\/|\/)?[\w\-./]+\.[\w]+)/g;
const DIR_REF_PATTERN = /@((?:~\/|\.\/|\.\.\/|\/)?[\w\-./]+\/)/g;
const MAX_FILE_SIZE = 100_000; // 100KB per file

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".rb": "ruby",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".cs": "csharp", ".swift": "swift",
  ".kt": "kotlin", ".php": "php", ".sql": "sql", ".sh": "bash", ".yaml": "yaml",
  ".yml": "yaml", ".json": "json", ".toml": "toml", ".md": "markdown", ".html": "html",
  ".css": "css", ".scss": "scss", ".vue": "vue", ".svelte": "svelte",
};

/**
 * Extract @file references from text
 */
export function extractReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(FILE_REF_PATTERN)) {
    refs.add(match[1]!);
  }
  for (const match of text.matchAll(DIR_REF_PATTERN)) {
    refs.add(match[1]!);
  }
  return Array.from(refs);
}

/**
 * Resolve a single file reference to absolute path
 */
function resolvePath(ref: string, projectRoot: string): string {
  if (ref.startsWith("~/")) return path.join(homedir(), ref.slice(2));
  if (path.isAbsolute(ref)) return ref;
  return path.join(projectRoot, ref);
}

/**
 * Resolve all @file references in a message, return resolved content
 */
export async function resolveReferences(text: string, projectRoot: string): Promise<ResolvedReference[]> {
  const refs = extractReferences(text);
  const results: ResolvedReference[] = [];

  for (const ref of refs) {
    const absPath = resolvePath(ref, projectRoot);
    try {
      const stat = await fs.stat(absPath);
      if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
        const content = await fs.readFile(absPath, "utf-8");
        const ext = path.extname(absPath).toLowerCase();
        results.push({ path: ref, content, language: EXT_TO_LANG[ext] });
      } else if (stat.isDirectory()) {
        // List directory contents (shallow)
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        const listing = entries
          .slice(0, 50)
          .map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
          .join("\n");
        results.push({ path: ref, content: listing });
      }
    } catch {
      // Skip unresolvable references silently
    }
  }
  return results;
}

/**
 * Expand a user message: replace @file refs with inline content blocks
 * Returns the augmented message with file contents injected
 */
export async function expandFileReferences(text: string, projectRoot: string): Promise<string> {
  const resolved = await resolveReferences(text, projectRoot);
  if (!resolved.length) return text;

  const blocks = resolved.map(r => {
    const lang = r.language ? ` language="${r.language}"` : "";
    return `<file_reference path="${r.path}"${lang}>\n${r.content}\n</file_reference>`;
  });

  // Strip the @refs from the original text for cleanliness
  let cleaned = text;
  for (const r of resolved) {
    cleaned = cleaned.replace(new RegExp(`@${r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `[${r.path}]`);
  }

  return `${cleaned}\n\n${blocks.join("\n\n")}`;
}
