/**
 * tool_search.ts — Semantic tool discovery.
 * Searches the registry by query text and returns relevant tool definitions.
 */

import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";
import type { ToolRegistry } from "../registry.js";

let _fullRegistry: ToolRegistry | null = null;

export function setToolSearchRegistry(registry: ToolRegistry) {
  _fullRegistry = registry;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_]/g, " ").split(/\s+/).filter(Boolean);
}

function scoreToolMatch(def: ToolDefinition, query: string): number {
  const q = query.toLowerCase();
  const queryTokens = tokenize(q);
  const toolNameNorm = def.name.replace(/_/g, " ").toLowerCase();
  const desc = def.description.toLowerCase();
  let score = 0;

  // Exact name match
  if (def.name === q || toolNameNorm === q) score += 100;
  // Name contains query
  if (def.name.includes(q.replace(/\s/g, "_")) || toolNameNorm.includes(q)) score += 50;
  // Query tokens in name
  for (const token of queryTokens) {
    if (toolNameNorm.includes(token)) score += 10;
  }
  // Description relevance
  for (const token of queryTokens) {
    if (desc.includes(token)) score += 3;
  }
  // Phrase match in description
  if (desc.includes(q)) score += 20;

  return score;
}

export const toolSearchDef: ToolDefinition = {
  name: "tool_search",
  description: "Find tools in the registry that match a natural language query. Returns the most relevant tool definitions with descriptions and parameters.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to do (e.g., 'read a file', 'run shell command')" },
      show_parameters: { type: "boolean", description: "Include parameter details in results" },
    },
    required: ["query"],
  },
};

export const toolSearch: ToolHandler = async (args) => {
  const query = args["query"] as string;
  const showParams = args["show_parameters"] as boolean | undefined;

  if (!_fullRegistry) return "Tool registry not initialized.";

  const defs = _fullRegistry.getDefinitions();
  const scored = defs
    .map(def => ({ def, score: scoreToolMatch(def, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!scored.length) return `No tools found matching "${query}".`;

  const lines = [`Found ${scored.length} tools matching "${query}":\n`];
  for (const { def } of scored) {
    lines.push(`  ${def.name}`);
    lines.push(`    ${def.description.split(".")[0]}.`);
    if (showParams) {
      const props = (def.parameters as any)?.properties || {};
      const required = new Set((def.parameters as any)?.required || []);
      for (const [name, schema] of Object.entries(props) as [string, any][]) {
        const req = required.has(name) ? "*" : " ";
        lines.push(`    ${req} ${name}: ${schema.description || schema.type || ""}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
};

export const toolListDef: ToolDefinition = {
  name: "tool_list",
  description: "List all available tools grouped by category.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", description: "Optional: filter by category prefix (e.g., 'git', 'lsp', 'web')" },
    },
    required: [],
  },
};

export const toolList: ToolHandler = async (args) => {
  const category = args["category"] as string | undefined;

  if (!_fullRegistry) return "Tool registry not initialized.";

  const defs = _fullRegistry.getDefinitions();
  const filtered = category ? defs.filter(d => d.name.startsWith(category)) : defs;

  if (!filtered.length) return category ? `No tools found with prefix '${category}'.` : "No tools registered.";

  const groups: Record<string, ToolDefinition[]> = {
    "Code Intelligence": [],
    "File System": [],
    "Git": [],
    "Testing": [],
    "Web & HTTP": [],
    "Terminal": [],
    "Package Manager": [],
    "LSP": [],
    "Memory & Knowledge": [],
    "Agent": [],
    "Other": [],
  };

  for (const def of filtered) {
    if (def.name.startsWith("find_") || def.name.startsWith("project_") || def.name === "code_context") groups["Code Intelligence"]!.push(def);
    else if (["read_file", "write_file", "edit_file", "list_directory", "search_files", "apply_patch", "grep_search", "glob_files"].includes(def.name)) groups["File System"]!.push(def);
    else if (def.name.startsWith("git_")) groups["Git"]!.push(def);
    else if (def.name.startsWith("run_") || def.name === "test_coverage") groups["Testing"]!.push(def);
    else if (def.name.startsWith("web_") || def.name.startsWith("http_")) groups["Web & HTTP"]!.push(def);
    else if (def.name.startsWith("terminal_")) groups["Terminal"]!.push(def);
    else if (["add_dependency", "remove_dependency", "list_dependencies", "outdated_dependencies"].includes(def.name)) groups["Package Manager"]!.push(def);
    else if (def.name.startsWith("lsp_")) groups["LSP"]!.push(def);
    else if (def.name.startsWith("kb_") || def.name.startsWith("checkpoint_")) groups["Memory & Knowledge"]!.push(def);
    else if (["subagent", "delegate", "delegate_result", "delegate_list", "think", "tool_search", "tool_list"].includes(def.name)) groups["Agent"]!.push(def);
    else groups["Other"]!.push(def);
  }

  const lines = [`Available tools (${filtered.length} total):\n`];
  for (const [groupName, tools] of Object.entries(groups)) {
    if (!tools.length) continue;
    lines.push(`${groupName} (${tools.length}):`);
    for (const t of tools) {
      lines.push(`  ${t.name.padEnd(30)} ${t.description.split(".")[0]}.`);
    }
    lines.push("");
  }

  return lines.join("\n");
};
