/**
 * Smart Pruning - Context-aware tool output pruning
 * Protects recent outputs and specific tool types (skills, read)
 * Prunes older large outputs to stay within context budget
 */

export interface PruneConfig {
  /** Minimum output size to consider for pruning (default: 20000 chars) */
  pruneMinimum?: number;
  /** Protect the last N chars of conversation from pruning (default: 40000) */
  protectRecent?: number;
  /** Tools whose output should never be pruned */
  protectedTools?: string[];
  /** Max chars to keep from pruned output (default: 2000) */
  prunedKeepChars?: number;
}

interface ToolOutput {
  toolName: string;
  output: string;
  index: number;
}

const DEFAULT_CONFIG: Required<PruneConfig> = {
  pruneMinimum: 20_000,
  protectRecent: 40_000,
  protectedTools: ["skill", "read", "knowledge_base"],
  prunedKeepChars: 2_000,
};

/**
 * Prune large tool outputs from conversation messages.
 * Returns messages with oversized outputs truncated, preserving recent context.
 */
export function pruneToolOutputs(
  messages: Array<{ role: string; content: string; toolName?: string }>,
  config?: PruneConfig,
): Array<{ role: string; content: string; toolName?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Calculate total chars to find the protection boundary
  let totalChars = 0;
  for (const m of messages) totalChars += m.content.length;
  const protectionStart = totalChars - cfg.protectRecent;

  // Walk through messages, tracking cumulative position
  let cumulative = 0;
  return messages.map((m) => {
    const start = cumulative;
    cumulative += m.content.length;

    // Don't prune if in protected zone (recent)
    if (start >= protectionStart) return m;

    // Don't prune non-tool messages or small outputs
    if (m.role !== "tool_result" || m.content.length < cfg.pruneMinimum) return m;

    // Don't prune protected tools
    if (m.toolName && cfg.protectedTools.includes(m.toolName)) return m;

    // Prune: keep head + tail
    const keepHalf = Math.floor(cfg.prunedKeepChars / 2);
    const head = m.content.slice(0, keepHalf);
    const tail = m.content.slice(-keepHalf);
    const pruned = `${head}\n\n... [${m.content.length - cfg.prunedKeepChars} chars pruned] ...\n\n${tail}`;
    return { ...m, content: pruned };
  });
}

/**
 * Estimate if pruning would help stay within token budget.
 * Returns the amount of chars that could be freed by pruning.
 */
export function estimatePruneSavings(
  messages: Array<{ role: string; content: string; toolName?: string }>,
  config?: PruneConfig,
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let totalChars = 0;
  for (const m of messages) totalChars += m.content.length;
  const protectionStart = totalChars - cfg.protectRecent;

  let savings = 0;
  let cumulative = 0;
  for (const m of messages) {
    const start = cumulative;
    cumulative += m.content.length;
    if (start >= protectionStart) continue;
    if (m.role !== "tool_result" || m.content.length < cfg.pruneMinimum) continue;
    if (m.toolName && cfg.protectedTools.includes(m.toolName)) continue;
    savings += m.content.length - cfg.prunedKeepChars;
  }
  return savings;
}
