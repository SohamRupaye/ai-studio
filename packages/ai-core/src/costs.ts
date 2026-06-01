interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
}

const PRICING: Record<string, [number, number]> = {
  "claude-sonnet": [3, 15],
  "claude-haiku": [0.25, 1.25],
  "claude-opus": [15, 75],
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-5": [5, 15],
  "o1": [15, 60],
  "o3": [10, 40],
  "o4-mini": [1.1, 4.4],
  "gemini-2.0-flash": [0.075, 0.3],
  "gemini-2.5-pro": [1.25, 10],
};

function getRate(model: string): [number, number] {
  for (const [prefix, rate] of Object.entries(PRICING)) {
    if (model.includes(prefix)) return rate;
  }
  return [1, 3];
}

export class CostTracker {
  private entries: CostEntry[] = [];

  record(model: string, usage: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number }) {
    const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
    const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
    const [inRate, outRate] = getRate(model);
    const cost = (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
    this.entries.push({ model, inputTokens, outputTokens, cost, timestamp: Date.now() });
  }

  get totalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  get totalTokens(): { input: number; output: number } {
    return {
      input: this.entries.reduce((sum, e) => sum + e.inputTokens, 0),
      output: this.entries.reduce((sum, e) => sum + e.outputTokens, 0),
    };
  }

  summary(): string {
    const t = this.totalTokens;
    const lines = [
      `Total cost: $${this.totalCost.toFixed(4)}`,
      `Tokens: ${t.input.toLocaleString()} in / ${t.output.toLocaleString()} out`,
      `Calls: ${this.entries.length}`,
    ];
    const byModel: Record<string, { calls: number; cost: number }> = {};
    for (const e of this.entries) {
      if (!byModel[e.model]) byModel[e.model] = { calls: 0, cost: 0 };
      byModel[e.model]!.calls++;
      byModel[e.model]!.cost += e.cost;
    }
    for (const [model, data] of Object.entries(byModel)) {
      lines.push(`  ${model}: ${data.calls} calls, $${data.cost.toFixed(4)}`);
    }
    return lines.join("\n");
  }

  lastCost(): string {
    const last = this.entries[this.entries.length - 1];
    if (!last) return "";
    return `$${last.cost.toFixed(4)} (${last.inputTokens + last.outputTokens} tokens)`;
  }
}
