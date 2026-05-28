import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

export const readFileDef: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Returns the file text.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Absolute or relative file path" }, offset: { type: "number", description: "Line offset to start from" }, limit: { type: "number", description: "Max lines to read" } }, required: ["path"] },
};

export const readFile: ToolHandler = async (args) => {
  const path = args["path"] as string;
  const offset = (args["offset"] as number) || 0;
  const limit = (args["limit"] as number) || 0;
  const content = readFileSync(path, "utf-8");
  if (!offset && !limit) return content;
  const lines = content.split("\n");
  const sliced = limit ? lines.slice(offset, offset + limit) : lines.slice(offset);
  return sliced.join("\n");
};

export const writeFileDef: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates parent directories if needed.",
  parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
};

export const writeFile: ToolHandler = async (args) => {
  const path = args["path"] as string;
  mkdirSync(dirname(path), { recursive: true });
  const newContent = args["content"] as string;

  // Compute diff summary if file already exists
  let diffSummary = "";
  if (existsSync(path)) {
    const oldContent = readFileSync(path, "utf-8");
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const added = newLines.length - oldLines.length;
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const linesRemoved = oldLines.filter(l => !newSet.has(l)).length;
    const linesAdded = newLines.filter(l => !oldSet.has(l)).length;
    diffSummary = `\n  ${oldLines.length} → ${newLines.length} lines | +${linesAdded} -${linesRemoved}`;
  } else {
    const lineCount = newContent.split("\n").length;
    diffSummary = `\n  new file: ${lineCount} lines`;
  }

  writeFileSync(path, newContent);
  return `Written to ${path}${diffSummary}`;
};

export const listDirDef: ToolDefinition = {
  name: "list_directory",
  description: "List files and directories at a path.",
  parameters: { type: "object", properties: { path: { type: "string" }, depth: { type: "number", description: "Max depth (default 1)" } }, required: ["path"] },
};

export const listDir: ToolHandler = async (args) => {
  const dir = args["path"] as string;
  const maxDepth = (args["depth"] as number) || 1;
  const results: string[] = [];

  function walk(p: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = readdirSync(p);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(p, entry);
      const stat = statSync(full);
      const rel = relative(dir, full);
      results.push(stat.isDirectory() ? `${rel}/` : rel);
      if (stat.isDirectory() && depth < maxDepth) walk(full, depth + 1);
    }
  }
  walk(dir, 1);
  return results.join("\n");
};

export const editFileDef: ToolDefinition = {
  name: "edit_file",
  description: "Replace the first occurrence of old_str with new_str in a file. Shows a diff preview.",
  parameters: { type: "object", properties: { path: { type: "string" }, old_str: { type: "string", description: "Exact text to find (first occurrence)" }, new_str: { type: "string", description: "Replacement text" } }, required: ["path", "old_str", "new_str"] },
};

export const editFile: ToolHandler = async (args) => {
  const path = args["path"] as string;
  const oldStr = args["old_str"] as string;
  const newStr = args["new_str"] as string;
  const content = readFileSync(path, "utf-8");
  const idx = content.indexOf(oldStr);
  if (idx === -1) return `Error: old_str not found in ${path}`;
  const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
  writeFileSync(path, updated);

  // Compute inline diff for confirmation
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const diffLines: string[] = [`Edited ${path}:\n`];
  for (const l of oldLines) diffLines.push(`- ${l}`);
  for (const l of newLines) diffLines.push(`+ ${l}`);

  const remaining = (updated.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  if (remaining > 0) diffLines.push(`\n(${remaining} more occurrence${remaining > 1 ? "s" : ""} remain — use edit_file again to replace them)`);
  return diffLines.join("\n");
};

export const searchFilesDef: ToolDefinition = {
  name: "search_files",
  description: "Search for a regex pattern across files in a directory.",
  parameters: { type: "object", properties: { path: { type: "string" }, pattern: { type: "string" }, include: { type: "string", description: "File extension filter e.g. '.ts'" } }, required: ["path", "pattern"] },
};

export const searchFiles: ToolHandler = async (args) => {
  const dir = args["path"] as string;
  const pattern = new RegExp(args["pattern"] as string, "gi");
  const include = args["include"] as string | undefined;
  const results: string[] = [];

  function walk(p: string) {
    if (results.length > 50) return;
    for (const entry of readdirSync(p)) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
      const full = join(p, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (include && !full.endsWith(include)) continue;
      try {
        const content = readFileSync(full, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i]!)) {
            results.push(`${relative(dir, full)}:${i + 1}: ${lines[i]!.trim()}`);
            if (results.length > 50) return;
          }
          pattern.lastIndex = 0;
        }
      } catch { /* skip binary */ }
    }
  }
  walk(dir);
  return results.join("\n") || "No matches found.";
};
