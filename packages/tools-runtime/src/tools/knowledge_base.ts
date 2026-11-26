/**
 * knowledge_base.ts — Persistent project knowledge base tool.
 * Stores architecture notes, style decisions, API contracts, gotchas.
 * Backed by its own JSON file per project root, with tag filtering and search.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Storage ───────────────────────────────────────────────────────────────────

interface KnowledgeEntry {
  id: number;
  title: string;
  content: string;
  tags: string[];
  category: "architecture" | "style" | "api" | "gotcha" | "decision" | "note";
  createdAt: number;
  updatedAt: number;
}

class KnowledgeStore {
  private entries: KnowledgeEntry[] = [];
  private nextId = 1;
  private filePath: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, ".ai-studio");
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, "knowledge.json");
    this.load();
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
      this.entries = data.entries || [];
      this.nextId = this.entries.length ? Math.max(...this.entries.map(e => e.id)) + 1 : 1;
    } catch {}
  }

  private save() {
    writeFileSync(this.filePath, JSON.stringify({ entries: this.entries }, null, 2));
  }

  add(entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">): KnowledgeEntry {
    const now = Date.now();
    const e: KnowledgeEntry = { id: this.nextId++, ...entry, createdAt: now, updatedAt: now };
    this.entries.push(e);
    this.save();
    return e;
  }

  update(id: number, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt">>): boolean {
    const e = this.entries.find(x => x.id === id);
    if (!e) return false;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.save();
    return true;
  }

  remove(id: number): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    this.save();
    return true;
  }

  search(query: string, tags?: string[], category?: string): KnowledgeEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter(e => {
      if (category && e.category !== category) return false;
      if (tags?.length && !tags.some(t => e.tags.includes(t))) return false;
      if (q && !e.title.toLowerCase().includes(q) && !e.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  list(category?: string, tags?: string[]): KnowledgeEntry[] {
    return this.entries.filter(e => {
      if (category && e.category !== category) return false;
      if (tags?.length && !tags.some(t => e.tags.includes(t))) return false;
      return true;
    });
  }

  get(id: number): KnowledgeEntry | undefined {
    return this.entries.find(e => e.id === id);
  }
}

// Cache per project root
const stores = new Map<string, KnowledgeStore>();
function getStore(root: string): KnowledgeStore {
  if (!stores.has(root)) stores.set(root, new KnowledgeStore(root));
  return stores.get(root)!;
}

// The desktop app has its own Project concept (a UUID, not a filesystem
// path) — main sets this to the current turn's project directory before
// running the agent loop, so kb_write/kb_read default to the SAME store the
// Knowledge base page reads, instead of an unrelated process.cwd(). A model
// that explicitly passes project_root still wins (kept for the coding-agent
// use case this tool originated from).
let turnRoot: string | null = null;
export function setKnowledgeBaseRoot(root: string | null): void {
  turnRoot = root;
}
function resolveRoot(argRoot: string | undefined): string {
  return argRoot || turnRoot || process.cwd();
}

// ── IPC-friendly wrappers (used by the desktop app's main process) ──────────
// These operate on a single KnowledgeStore rooted at the app's data directory,
// independent of the agent tool's per-call `project_root` argument.

export type { KnowledgeEntry };

export function kbListEntries(root: string, category?: string, tags?: string[]): KnowledgeEntry[] {
  return getStore(root).list(category, tags);
}

export function kbSearchEntries(root: string, query: string, category?: string, tags?: string[]): KnowledgeEntry[] {
  return getStore(root).search(query, tags, category);
}

export function kbAddEntry(
  root: string,
  entry: { title: string; content: string; category?: KnowledgeEntry["category"]; tags?: string[] },
): KnowledgeEntry {
  return getStore(root).add({
    title: entry.title,
    content: entry.content,
    category: entry.category ?? "note",
    tags: entry.tags ?? [],
  });
}

export function kbRemoveEntry(root: string, id: number): boolean {
  return getStore(root).remove(id);
}

function formatEntry(e: KnowledgeEntry, short = false): string {
  const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
  const header = `[${e.id}] ${e.category.toUpperCase()} — ${e.title}${tags}`;
  if (short) return header;
  return `${header}\n${e.content}\n  (updated: ${new Date(e.updatedAt).toLocaleString()})`;
}

// ── Tool: kb_write ────────────────────────────────────────────────────────────

export const kbWriteDef: ToolDefinition = {
  name: "kb_write",
  description: "Write a knowledge note to the project knowledge base. Use this to store architecture decisions, API contracts, style guidelines, gotchas, or anything the agent should remember about the project.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the note" },
      content: { type: "string", description: "Full note content (markdown supported)" },
      category: {
        type: "string",
        description: "Category: architecture | style | api | gotcha | decision | note",
      },
      tags: {
        type: "array",
        description: "Optional tags for filtering",
        items: { type: "string" },
      },
      project_root: { type: "string" },
    },
    required: ["title", "content"],
  },
};

export const kbWrite: ToolHandler = async (args) => {
  const root = resolveRoot(args["project_root"] as string | undefined);
  const store = getStore(root);

  const entry = store.add({
    title: args["title"] as string,
    content: args["content"] as string,
    category: (args["category"] as KnowledgeEntry["category"]) || "note",
    tags: (args["tags"] as string[]) || [],
  });

  return `✅ Knowledge note saved [id=${entry.id}]\n${formatEntry(entry)}`;
};

// ── Tool: kb_read ─────────────────────────────────────────────────────────────

export const kbReadDef: ToolDefinition = {
  name: "kb_read",
  description: "Read the project knowledge base. List all entries, filter by category/tags, or get a specific entry by id.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "Get a specific entry by id" },
      category: { type: "string", description: "Filter by category: architecture | style | api | gotcha | decision | note" },
      tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
      project_root: { type: "string" },
    },
    required: [],
  },
};

export const kbRead: ToolHandler = async (args) => {
  const root = resolveRoot(args["project_root"] as string | undefined);
  const store = getStore(root);

  if (args["id"] !== undefined) {
    const entry = store.get(args["id"] as number);
    if (!entry) return `No knowledge entry with id=${args["id"]}.`;
    return formatEntry(entry);
  }

  const category = args["category"] as string | undefined;
  const tags = args["tags"] as string[] | undefined;
  const entries = store.list(category, tags);

  if (!entries.length) return "Knowledge base is empty." + (category ? ` (no entries in category '${category}')` : "");

  const lines = [`Knowledge Base (${entries.length} entries):\n`];
  for (const e of entries) lines.push("  " + formatEntry(e, true));
  return lines.join("\n");
};

// ── Tool: kb_search ───────────────────────────────────────────────────────────

export const kbSearchDef: ToolDefinition = {
  name: "kb_search",
  description: "Search the project knowledge base by query text. Returns matching notes with full content.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search term to find in titles and content" },
      category: { type: "string", description: "Optionally limit to a category" },
      tags: { type: "array", items: { type: "string" }, description: "Optionally filter by tags" },
      project_root: { type: "string" },
    },
    required: ["query"],
  },
};

export const kbSearch: ToolHandler = async (args) => {
  const root = resolveRoot(args["project_root"] as string | undefined);
  const store = getStore(root);

  const results = store.search(
    args["query"] as string,
    args["tags"] as string[] | undefined,
    args["category"] as string | undefined
  );

  if (!results.length) return `No knowledge entries matching '${args["query"]}'.`;
  const lines = [`Found ${results.length} matching entries:\n`];
  for (const e of results) {
    lines.push(formatEntry(e));
    lines.push("");
  }
  return lines.join("\n");
};

// ── Tool: kb_delete ───────────────────────────────────────────────────────────

export const kbDeleteDef: ToolDefinition = {
  name: "kb_delete",
  description: "Delete a knowledge note by id.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "Entry id to delete" },
      project_root: { type: "string" },
    },
    required: ["id"],
  },
};

export const kbDelete: ToolHandler = async (args) => {
  const root = resolveRoot(args["project_root"] as string | undefined);
  const store = getStore(root);
  const ok = store.remove(args["id"] as number);
  return ok ? `✅ Deleted knowledge entry ${args["id"]}.` : `No entry with id=${args["id"]}.`;
};
