import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Organisation } from "@squirl/shared";

export class OrganisationsRepository {
  constructor(private db: Database.Database) {}

  createOrganisation(name: string): Organisation {
    const org: Organisation = { id: randomUUID(), name, createdAt: Date.now() };
    this.db.prepare("INSERT INTO organisations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(org.id, org.name, org.createdAt, org.createdAt);
    return org;
  }

  getOrganisation(id: string): Organisation | undefined {
    const row = this.db.prepare("SELECT * FROM organisations WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, name: row.name, createdAt: row.created_at };
  }

  listOrganisations(): Organisation[] {
    return (this.db.prepare("SELECT * FROM organisations ORDER BY created_at").all() as any[])
      .map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  renameOrganisation(id: string, name: string): void {
    this.db.prepare("UPDATE organisations SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
  }

  /**
   * Every project row of the org — soft-deleted ones included. Org deletion
   * iterates this (not listProjects) so rows left over from the soft-delete
   * era get purged too; otherwise their org_id FK blocks the org row delete.
   */
  listProjectIds(orgId: string): string[] {
    return (this.db.prepare("SELECT id FROM projects WHERE org_id = ?").all(orgId) as any[])
      .map(r => r.id);
  }

  /**
   * Hard-delete an organisation row and its memberships. Callers must have
   * emptied it first (hard-deleting each project via listProjectIds);
   * refuses while any project row remains — live or soft-deleted — and
   * callers should refuse to delete the last organisation.
   */
  deleteOrganisation(id: string): boolean {
    const org = this.getOrganisation(id);
    if (!org) return false;
    if (this.listProjectIds(id).length) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM team_members WHERE org_id = ?").run(id);
      this.db.prepare("DELETE FROM organisations WHERE id = ?").run(id);
    })();
    return true;
  }

  /** Org-scoped API keys ({provider: key}) — override the global config keys. */
  getOrgApiKeys(id: string): Record<string, string> {
    const row = this.db.prepare("SELECT api_keys FROM organisations WHERE id = ?").get(id) as any;
    if (!row?.api_keys) return {};
    try {
      return JSON.parse(row.api_keys) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Merge a patch into an org's API keys, mirroring saveConfig's semantics:
   * `null` clears a key, empty strings are ignored (so a form can submit all
   * fields without wiping saved keys), non-empty values are set.
   */
  setOrgApiKeys(id: string, patch: Record<string, string | null>): void {
    const keys = this.getOrgApiKeys(id);
    for (const [provider, value] of Object.entries(patch)) {
      if (value === null) delete keys[provider];
      else if (typeof value === "string" && value.trim()) keys[provider] = value.trim();
    }
    this.db.prepare("UPDATE organisations SET api_keys = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(keys), Date.now(), id);
  }
}
