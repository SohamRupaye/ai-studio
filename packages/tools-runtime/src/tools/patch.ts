import { readFileSync, writeFileSync } from "node:fs";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

export const patchDef: ToolDefinition = {
  name: "apply_patch",
  description: "Apply a unified diff patch to a file.",
  parameters: { type: "object", properties: { path: { type: "string" }, patch: { type: "string", description: "Unified diff content" } }, required: ["path", "patch"] },
};

export const patch: ToolHandler = async (args) => {
  const path = args["path"] as string;
  const patchText = args["patch"] as string;
  const lines = readFileSync(path, "utf-8").split("\n");
  const hunks = parseHunks(patchText);
  if (!hunks.length) return "Error: no valid hunks found in patch";

  let offset = 0;
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1 + offset;
    // Verify context
    let valid = true;
    for (let i = 0; i < hunk.oldLines.length; i++) {
      if (lines[start + i] !== hunk.oldLines[i]) { valid = false; break; }
    }
    if (!valid) return `Error: context mismatch at line ${hunk.oldStart}`;
    lines.splice(start, hunk.oldLines.length, ...hunk.newLines);
    offset += hunk.newLines.length - hunk.oldLines.length;
  }

  writeFileSync(path, lines.join("\n"));
  return `Patched ${path} (${hunks.length} hunk${hunks.length > 1 ? "s" : ""})`;
};

interface Hunk { oldStart: number; oldLines: string[]; newLines: string[] }

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = patch.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = lines[i]!.match(/^@@\s*-(\d+)/);
    if (!m) { i++; continue; }
    const oldStart = parseInt(m[1]!);
    const oldLines: string[] = [];
    const newLines: string[] = [];
    i++;
    while (i < lines.length && !lines[i]!.startsWith("@@")) {
      const line = lines[i]!;
      if (line.startsWith("-")) oldLines.push(line.slice(1));
      else if (line.startsWith("+")) newLines.push(line.slice(1));
      else if (line.startsWith(" ")) { oldLines.push(line.slice(1)); newLines.push(line.slice(1)); }
      else break;
      i++;
    }
    hunks.push({ oldStart, oldLines, newLines });
  }
  return hunks;
}
