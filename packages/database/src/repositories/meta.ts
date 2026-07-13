import type Database from "better-sqlite3";

export class MetaRepository {
  constructor(private db: Database.Database) {}

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as any;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  getActiveBranchId(): string | undefined {
    return this.getMeta("active_branch");
  }

  setActiveBranchId(id: string): void {
    this.setMeta("active_branch", id);
  }
}
