import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Automation } from "@squirl/shared";

/** Scheduled recurring agent tasks. next_run_at is computed by the desktop
 * scheduler (croner lives there, not in this package) and stored so the
 * schedule survives restarts and overdue runs can be detected on boot. */
export class AutomationsRepository {
  constructor(private db: Database.Database) {}

  createAutomation(input: { branchId: string; projectId?: string; name: string; schedule: string; task: string; nextRunAt?: number }): Automation {
    const a: Automation = {
      id: randomUUID(),
      branchId: input.branchId,
      projectId: input.projectId,
      name: input.name,
      schedule: input.schedule,
      task: input.task,
      enabled: true,
      nextRunAt: input.nextRunAt,
      createdAt: Date.now(),
    };
    this.db.prepare(
      `INSERT INTO automations (id, project_id, branch_id, name, schedule, task, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(a.id, a.projectId ?? null, a.branchId, a.name, a.schedule, a.task, a.nextRunAt ?? null, a.createdAt);
    return a;
  }

  listAutomations(opts?: { enabledOnly?: boolean }): Automation[] {
    const rows = (opts?.enabledOnly
      ? this.db.prepare("SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at")
      : this.db.prepare("SELECT * FROM automations ORDER BY created_at")
    ).all() as any[];
    return rows.map(rowToAutomation);
  }

  getAutomation(id: string): Automation | undefined {
    const row = this.db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as any;
    return row ? rowToAutomation(row) : undefined;
  }

  setAutomationEnabled(id: string, enabled: boolean): boolean {
    return this.db.prepare("UPDATE automations SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id).changes > 0;
  }

  setAutomationNextRun(id: string, nextRunAt: number | null): void {
    this.db.prepare("UPDATE automations SET next_run_at = ? WHERE id = ?").run(nextRunAt, id);
  }

  recordAutomationRun(id: string, status: "ok" | "error", nextRunAt: number | null): void {
    this.db.prepare("UPDATE automations SET last_run_at = ?, last_status = ?, next_run_at = ? WHERE id = ?")
      .run(Date.now(), status, nextRunAt, id);
  }

  deleteAutomation(id: string): boolean {
    return this.db.prepare("DELETE FROM automations WHERE id = ?").run(id).changes > 0;
  }
}

function rowToAutomation(r: any): Automation {
  return {
    id: r.id,
    projectId: r.project_id ?? undefined,
    branchId: r.branch_id,
    name: r.name,
    schedule: r.schedule,
    task: r.task,
    enabled: !!r.enabled,
    nextRunAt: r.next_run_at ?? undefined,
    lastRunAt: r.last_run_at ?? undefined,
    lastStatus: r.last_status ?? undefined,
    createdAt: r.created_at,
  };
}
