import { execSync } from "node:child_process";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, { cwd: cwd || process.cwd(), encoding: "utf-8", timeout: 15_000 }).trim();
  } catch (e: any) {
    return `Error: ${e.stderr?.toString() || e.message}`.slice(0, 5000);
  }
}

export const gitStatusDef: ToolDefinition = {
  name: "git_status",
  description: "Show git status (modified, staged, untracked files).",
  parameters: { type: "object", properties: { cwd: { type: "string" } }, required: [] },
};
export const gitStatus: ToolHandler = async (args) => git("status --short", args["cwd"] as string);

export const gitDiffDef: ToolDefinition = {
  name: "git_diff",
  description: "Show git diff. Use staged=true for staged changes.",
  parameters: { type: "object", properties: { staged: { type: "boolean" }, path: { type: "string" }, cwd: { type: "string" } }, required: [] },
};
export const gitDiff: ToolHandler = async (args) => {
  const staged = args["staged"] ? " --staged" : "";
  const path = args["path"] ? ` -- ${args["path"]}` : "";
  return git(`diff${staged}${path}`, args["cwd"] as string);
};

export const gitLogDef: ToolDefinition = {
  name: "git_log",
  description: "Show recent git log entries.",
  parameters: { type: "object", properties: { count: { type: "number", description: "Number of entries (default 10)" }, cwd: { type: "string" } }, required: [] },
};
export const gitLog: ToolHandler = async (args) => {
  const n = (args["count"] as number) || 10;
  return git(`log --oneline -${n}`, args["cwd"] as string);
};

export const gitCommitDef: ToolDefinition = {
  name: "git_commit",
  description: "Stage files and create a git commit.",
  parameters: { type: "object", properties: { message: { type: "string" }, files: { type: "string", description: "Space-separated files to stage (or '.' for all)" }, cwd: { type: "string" } }, required: ["message"] },
};
export const gitCommit: ToolHandler = async (args) => {
  const cwd = args["cwd"] as string;
  const files = (args["files"] as string) || ".";
  git(`add ${files}`, cwd);
  return git(`commit -m "${(args["message"] as string).replace(/"/g, '\\"')}"`, cwd);
};

export const gitAddDef: ToolDefinition = {
  name: "git_add",
  description: "Stage files for commit.",
  parameters: { type: "object", properties: { files: { type: "string", description: "Space-separated file paths" }, cwd: { type: "string" } }, required: ["files"] },
};
export const gitAdd: ToolHandler = async (args) => git(`add ${args["files"]}`, args["cwd"] as string);
