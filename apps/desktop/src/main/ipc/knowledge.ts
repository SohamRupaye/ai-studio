import { join } from "node:path";
import { kbAddEntry, kbListEntries, kbRemoveEntry, kbSearchEntries } from "@squirl/tools-runtime";
import { dataDirPath, graph, store } from "../state.js";
import { handle } from "./handle.js";

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge base (manually/agent-authored notes) and knowledge graph
// (auto-extracted, embedding-linked decisions) — both per-project. The kb
// tool itself is keyed by an arbitrary `project_root` string (its original,
// filesystem-coding-agent shape); here we give every Squirl project a stable
// directory under the app's own data dir so the UI and the agent's kb_write
// calls land in the same store (see setKnowledgeBaseRoot in chat.ts).
// ─────────────────────────────────────────────────────────────────────────────

function kbRoot(projectId: string): string {
  return join(dataDirPath, "kb", projectId);
}

export function registerKnowledgeHandlers() {
  handle("kb:list", ({ projectId, category, tags }) => kbListEntries(kbRoot(projectId), category, tags));
  handle("kb:search", ({ projectId, query, category, tags }) =>
    kbSearchEntries(kbRoot(projectId), query, category, tags),
  );
  handle("kb:add", ({ projectId, title, content, category, tags }) =>
    kbAddEntry(kbRoot(projectId), { title, content, category, tags }),
  );
  handle("kb:remove", ({ projectId, id }) => kbRemoveEntry(kbRoot(projectId), id));

  // Nodes/edges the classifier wrote from turns on this project's branches.
  // A node without _branch metadata (shouldn't happen, but the field predates
  // this query) is included rather than silently hidden.
  handle("graph:for-project", ({ projectId }) => {
    const branchIds = new Set(store.projectImpact(projectId).branchIds);
    const nodes = graph.listNodes().filter((n) => {
      const branch = n.meta?.["_branch"];
      return !branch || branchIds.has(branch as string);
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = graph.listEdges().filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges };
  });
}
