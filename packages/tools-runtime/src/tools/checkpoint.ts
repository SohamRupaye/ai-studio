/**
 * checkpoint.ts — Patch/checkpoint stack for safe risky changes.
 * Before making risky edits, snapshot affected files.
 * Roll back any checkpoint at any time.
 * Checkpoints are stored as unified diffs in .ai-studio/checkpoints/.
 */

import { closeSync, fstatSync, openSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Storage ───────────────────────────────────────────────────────────────────

interface CheckpointMeta {
  id: string;
  label: string;
  files: string[];   // relative file paths snapshotted
  createdAt: number;
  description: string;
}

class CheckpointStore {
  private dir: string;
  private metaPath: string;
  private checkpoints: CheckpointMeta[] = [];

  constructor(root: string) {
    this.dir = join(root, ".ai-studio", "checkpoints");
    this.metaPath = join(root, ".ai-studio", "checkpoints", "index.json");
    mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  private load() {
    if (!existsSync(this.metaPath)) return;
    try { this.checkpoints = JSON.parse(readFileSync(this.metaPath, "utf-8")); } catch {}
  }

  private save() {
    writeFileSync(this.metaPath, JSON.stringify(this.checkpoints, null, 2));
  }

  private snapshotDir(checkpointId: string): string {
    return join(this.dir, checkpointId);
  }

  createCheckpoint(root: string, label: string, description: string, files: string[]): CheckpointMeta {
    const id = `cp_${Date.now()}`;
    const snapDir = this.snapshotDir(id);
    mkdirSync(snapDir, { recursive: true });

    const snapshotted: string[] = [];
    for (const relPath of files) {
      const absPath = resolve(root, relPath);
      let fd: number | undefined;
      try {
        fd = openSync(absPath, "r");
        const st = fstatSync(fd);
        if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
        const content = readFileSync(fd);
        const snapPath = join(snapDir, relPath.replace(/\//g, "__"));
        writeFileSync(snapPath, content);
        snapshotted.push(relPath);
      } catch {
        continue;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }

    const meta: CheckpointMeta = { id, label, files: snapshotted, createdAt: Date.now(), description };
    this.checkpoints.push(meta);
    this.save();
    return meta;
  }

  rollback(root: string, checkpointId: string): { restored: string[]; errors: string[] } {
    const meta = this.checkpoints.find(c => c.id === checkpointId);
    if (!meta) throw new Error(`Checkpoint '${checkpointId}' not found`);

    const snapDir = this.snapshotDir(checkpointId);
    const restored: string[] = [];
    const errors: string[] = [];

    for (const relPath of meta.files) {
      const snapPath = join(snapDir, relPath.replace(/\//g, "__"));
      if (!existsSync(snapPath)) { errors.push(`Snapshot not found: ${relPath}`); continue; }
      const absPath = resolve(root, relPath);
      mkdirSync(join(absPath, ".."), { recursive: true });
      writeFileSync(absPath, readFileSync(snapPath));
      restored.push(relPath);
    }

    return { restored, errors };
  }

  list(): CheckpointMeta[] { return [...this.checkpoints].reverse(); }

  get(id: string): CheckpointMeta | undefined {
    return this.checkpoints.find(c => c.id === id);
  }

  delete(id: string): boolean {
    const idx = this.checkpoints.findIndex(c => c.id === id);
    if (idx === -1) return false;

    const snapDir = this.snapshotDir(id);
    if (existsSync(snapDir)) {
      try {
        for (const f of readdirSync(snapDir)) unlinkSync(join(snapDir, f));
      } catch {}
    }

    this.checkpoints.splice(idx, 1);
    this.save();
    return true;
  }

  diff(root: string, checkpointId: string): string {
    const meta = this.checkpoints.find(c => c.id === checkpointId);
    if (!meta) return `Checkpoint '${checkpointId}' not found.`;

    const snapDir = this.snapshotDir(checkpointId);
    const diffs: string[] = [];

    for (const relPath of meta.files) {
      const snapPath = join(snapDir, relPath.replace(/\//g, "__"));
      const currentPath = resolve(root, relPath);

      if (!existsSync(snapPath)) { diffs.push(`--- ${relPath}: snapshot missing`); continue; }
      if (!existsSync(currentPath)) { diffs.push(`--- ${relPath}: file deleted`); continue; }

      const snap = readFileSync(snapPath, "utf-8");
      const current = readFileSync(currentPath, "utf-8");

      if (snap === current) { diffs.push(`  ${relPath}: unchanged`); continue; }

      // Simple line-by-line diff (no external tools)
      const snapLines = snap.split("\n");
      const currentLines = current.split("\n");
      diffs.push(`diff ${relPath}:`);

      let added = 0, removed = 0;
      const snapSet = new Set(snapLines);
      const currSet = new Set(currentLines);

      for (const l of snapLines) { if (!currSet.has(l)) { removed++; if (removed <= 5) diffs.push(`  - ${l.slice(0, 100)}`); } }
      for (const l of currentLines) { if (!snapSet.has(l)) { added++; if (added <= 5) diffs.push(`  + ${l.slice(0, 100)}`); } }
      diffs.push(`  (${added} lines added, ${removed} lines removed)`);
    }

    return diffs.join("\n");
  }
}

const stores = new Map<string, CheckpointStore>();
function getStore(root: string): CheckpointStore {
  if (!stores.has(root)) stores.set(root, new CheckpointStore(root));
  return stores.get(root)!;
}

// ── Tool: checkpoint_create ───────────────────────────────────────────────────

export const checkpointCreateDef: ToolDefinition = {
  name: "checkpoint_create",
  description: "Create a checkpoint snapshot of specific files before making risky changes. The checkpoint can be rolled back at any time.",
  parameters: {
    type: "object",
    properties: {
      label: { type: "string", description: "Short descriptive label (e.g. 'before-auth-refactor')" },
      files: {
        type: "array",
        description: "List of file paths (relative to project root) to snapshot",
        items: { type: "string" },
      },
      description: { type: "string", description: "What you're about to do (optional context)" },
      project_root: { type: "string" },
    },
    required: ["label", "files"],
  },
};

export const checkpointCreate: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const store = getStore(root);

  const meta = store.createCheckpoint(
    root,
    args["label"] as string,
    (args["description"] as string) || "",
    args["files"] as string[],
  );

  return `✅ Checkpoint created: ${meta.id}\nLabel: ${meta.label}\nFiles snapshotted (${meta.files.length}):\n${meta.files.map(f => "  " + f).join("\n")}`;
};

// ── Tool: checkpoint_list ─────────────────────────────────────────────────────

export const checkpointListDef: ToolDefinition = {
  name: "checkpoint_list",
  description: "List all available checkpoints with their labels and snapshotted files.",
  parameters: {
    type: "object",
    properties: { project_root: { type: "string" } },
    required: [],
  },
};

export const checkpointList: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const store = getStore(root);
  const cps = store.list();
  if (!cps.length) return "No checkpoints found.";

  const lines = [`Checkpoints (${cps.length}):\n`];
  for (const cp of cps) {
    const age = Math.round((Date.now() - cp.createdAt) / 60_000);
    lines.push(`  ${cp.id}  "${cp.label}"  (${age}m ago)  files: ${cp.files.length}`);
    if (cp.description) lines.push(`    ${cp.description}`);
  }
  return lines.join("\n");
};

// ── Tool: checkpoint_diff ─────────────────────────────────────────────────────

export const checkpointDiffDef: ToolDefinition = {
  name: "checkpoint_diff",
  description: "Show what has changed since a checkpoint was created (snapshot vs current file state).",
  parameters: {
    type: "object",
    properties: {
      checkpoint_id: { type: "string", description: "Checkpoint ID (from checkpoint_list)" },
      project_root: { type: "string" },
    },
    required: ["checkpoint_id"],
  },
};

export const checkpointDiff: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const store = getStore(root);
  return store.diff(root, args["checkpoint_id"] as string);
};

// ── Tool: checkpoint_rollback ─────────────────────────────────────────────────

export const checkpointRollbackDef: ToolDefinition = {
  name: "checkpoint_rollback",
  description: "Roll back to a checkpoint, restoring all snapshotted files to their state at checkpoint creation time.",
  parameters: {
    type: "object",
    properties: {
      checkpoint_id: { type: "string", description: "Checkpoint ID to restore" },
      project_root: { type: "string" },
    },
    required: ["checkpoint_id"],
  },
};

export const checkpointRollback: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const store = getStore(root);

  try {
    const { restored, errors } = store.rollback(root, args["checkpoint_id"] as string);
    const lines = [`✅ Rolled back to checkpoint '${args["checkpoint_id"]}':`];
    for (const f of restored) lines.push(`  ✓ ${f}`);
    for (const e of errors) lines.push(`  ✗ ${e}`);
    return lines.join("\n");
  } catch (e: any) {
    return `❌ Rollback failed: ${e.message}`;
  }
};

// ── Tool: checkpoint_delete ───────────────────────────────────────────────────

export const checkpointDeleteDef: ToolDefinition = {
  name: "checkpoint_delete",
  description: "Delete a checkpoint to free up disk space.",
  parameters: {
    type: "object",
    properties: {
      checkpoint_id: { type: "string" },
      project_root: { type: "string" },
    },
    required: ["checkpoint_id"],
  },
};

export const checkpointDelete: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const store = getStore(root);
  const ok = store.delete(args["checkpoint_id"] as string);
  return ok ? `✅ Deleted checkpoint '${args["checkpoint_id"]}'.` : `No checkpoint with id '${args["checkpoint_id"]}'.`;
};
