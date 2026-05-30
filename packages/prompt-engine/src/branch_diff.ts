import type { Store } from "@ai-studio/database";
import type { MetaGraph } from "@ai-studio/graph-engine";
import type { Branch } from "@ai-studio/shared";

export interface BranchDiff {
  onlyInA: Array<{ topic: string; decision: string; turn: number }>;
  onlyInB: Array<{ topic: string; decision: string; turn: number }>;
  shared: Array<{ topic: string; decisionA: string; decisionB: string }>;
  commonAncestor?: string;
}

/** Compare decisions between two branches using graph knowledge. */
export function compareBranches(
  store: Store,
  graph: MetaGraph,
  branchIdA: string,
  branchIdB: string,
): BranchDiff {
  const diff: BranchDiff = { onlyInA: [], onlyInB: [], shared: [] };

  // Find common ancestor
  const ancestorsA = getAncestorChain(store, branchIdA);
  const ancestorsB = getAncestorChain(store, branchIdB);
  const commonAncestor = ancestorsA.find(a => ancestorsB.includes(a));
  if (commonAncestor) diff.commonAncestor = commonAncestor;

  // Get graph nodes for each branch
  const nodesA = getDecisionsForBranch(graph, branchIdA);
  const nodesB = getDecisionsForBranch(graph, branchIdB);

  // Classify: shared topic (potentially conflicting) vs unique
  const topicsA = new Map(nodesA.map(n => [n.topic, n]));
  const topicsB = new Map(nodesB.map(n => [n.topic, n]));

  for (const [topic, nodeA] of topicsA) {
    const nodeB = topicsB.get(topic);
    if (nodeB) {
      if (nodeA.decision !== nodeB.decision) {
        diff.shared.push({ topic, decisionA: nodeA.decision, decisionB: nodeB.decision });
      }
    } else {
      diff.onlyInA.push(nodeA);
    }
  }

  for (const [topic, nodeB] of topicsB) {
    if (!topicsA.has(topic)) {
      diff.onlyInB.push(nodeB);
    }
  }

  return diff;
}

function getAncestorChain(store: Store, branchId: string): string[] {
  const chain: string[] = [branchId];
  let current = store.getBranch(branchId);
  let depth = 0;
  while (current?.parentId && depth < 30) {
    chain.push(current.parentId);
    current = store.getBranch(current.parentId);
    depth++;
  }
  return chain;
}

function getDecisionsForBranch(graph: MetaGraph, branchId: string): Array<{ topic: string; decision: string; turn: number }> {
  // Scan all nodes (using queryAsync would need an embedding; scan is fine for comparison)
  const results: Array<{ topic: string; decision: string; turn: number }> = [];
  // We access the DB through queryAsync with a generic query — but for comparison we need all branch nodes.
  // Use a direct query approach via the graph's getNode + size
  const size = graph.size;
  for (let id = 1; id <= size + 100; id++) {
    const node = graph.getNode(id);
    if (!node) continue;
    if (node.meta["_branch"] !== branchId) continue;
    if (!node.meta["decision"]) continue;
    results.push({
      topic: (node.meta["topic"] as string) || "unknown",
      decision: node.meta["decision"] as string,
      turn: (node.meta["_turn"] as number) || 0,
    });
  }
  return results;
}
