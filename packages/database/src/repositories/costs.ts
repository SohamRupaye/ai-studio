import type Database from "better-sqlite3";

export class CostsRepository {
  constructor(private db: Database.Database) {}

  recordCost(branchId: string, model: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.db.prepare(
      `INSERT INTO costs (branch_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(branchId, model, inputTokens, outputTokens, costUsd, Date.now());
  }

  getCosts(branchId: string): Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; timestamp: number }> {
    return (this.db.prepare("SELECT * FROM costs WHERE branch_id = ? ORDER BY timestamp").all(branchId) as any[])
      .map(r => ({ model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, timestamp: r.timestamp }));
  }

  getProjectCosts(projectId: string): { totalCost: number; totalInput: number; totalOutput: number } {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(c.cost_usd), 0) as total_cost,
             COALESCE(SUM(c.input_tokens), 0) as total_input,
             COALESCE(SUM(c.output_tokens), 0) as total_output
      FROM costs c
      JOIN branches b ON c.branch_id = b.id
      JOIN chats ch ON b.chat_id = ch.id
      WHERE ch.project_id = ?
    `).get(projectId) as any;
    return { totalCost: row.total_cost, totalInput: row.total_input, totalOutput: row.total_output };
  }
}
