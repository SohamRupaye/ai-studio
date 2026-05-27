import { embed, cosineSim, type MetaGraph } from "@ai-studio/graph-engine";

export function mmrRerank(
  queryEmb: number[],
  candidates: Array<{ id: number; score: number; meta: Record<string, any>; embedding: number[] }>,
  topK = 3,
  lambda = 0.7,
): Array<{ id: number; score: number; meta: Record<string, any> }> {
  if (!candidates.length) return [];
  const selected: Array<{ id: number; score: number; meta: Record<string, any>; embedding: number[] }> = [];
  const remaining = [...candidates];

  while (remaining.length && selected.length < topK) {
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const relevance = candidate.score;
      let maxSim = 0;

      if (selected.length > 0) {
        maxSim = Math.max(...selected.map(sel => cosineSim(candidate.embedding, sel.embedding)));
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      selected.push(remaining.splice(bestIdx, 1)[0]!);
    } else {
      break;
    }
  }

  return selected.map(s => ({ id: s.id, score: s.score, meta: s.meta }));
}

/**
 * Retrieve relevant knowledge from the graph.
 * Cross-branch sharing: nodes from any branch are included, with a small
 * relevance boost for same-branch nodes (locality preference).
 */
export async function retrieveFromGraph(
  query: string,
  graph?: MetaGraph,
  topK = 3,
  minScore = 0.4,
  branchId?: string,
): Promise<string[]> {
  if (!graph || graph.size === 0) return [];
  try {
    const queryEmb = await embed(query);
    if (!queryEmb.length) return [];

    const results = await graph.queryAsync(query, topK * 5);
    const candidatesMap = new Map<number, { id: number; score: number; meta: Record<string, any>; embedding: number[] }>();

    for (const res of results) {
      if (res.score < minScore) continue;

      const nodeData = graph.getNode(res.id);
      if (!nodeData) continue;

      // Boost same-branch nodes slightly for locality, but include all branches
      const localityBoost = (branchId && res.meta["_branch"] === branchId) ? 0.05 : 0;
      const adjustedScore = res.score + localityBoost;

      candidatesMap.set(res.id, { id: res.id, score: adjustedScore, meta: res.meta as Record<string, any>, embedding: nodeData.embedding });

      // Expand neighbors (cross-branch allowed)
      const neighbors = graph.getNeighbors(res.id);
      for (const n of neighbors.slice(0, 10)) {
        if (candidatesMap.has(n.id)) continue;
        const neighborNode = graph.getNode(n.id);
        if (!neighborNode) continue;
        const score = cosineSim(queryEmb, neighborNode.embedding);
        if (score < minScore) continue;
        const nBoost = (branchId && neighborNode.meta["_branch"] === branchId) ? 0.05 : 0;
        candidatesMap.set(n.id, { id: n.id, score: score + nBoost, meta: neighborNode.meta as Record<string, any>, embedding: neighborNode.embedding });
      }
    }

    const candidates = Array.from(candidatesMap.values());
    const ranked = mmrRerank(queryEmb, candidates, topK);
    const blocks: string[] = [];
    for (const r of ranked) {
      const parts: string[] = [];
      const meta = r.meta;
      if (meta["topic"]) parts.push(`Topic: ${meta["topic"]}`);
      if (meta["decision"]) parts.push(`Decision: ${meta["decision"]}`);
      if (meta["constraint"]) parts.push(`Constraint: ${meta["constraint"]}`);
      if (meta["intent"]) parts.push(`Intent: ${meta["intent"]}`);
      if (meta["_branch"] && meta["_branch"] !== branchId) parts.push(`(from branch ${meta["_branch"]})`);
      if (parts.length) blocks.push(parts.join(" | "));
    }
    return blocks;
  } catch {
    return [];
  }
}
