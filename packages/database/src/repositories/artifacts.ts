import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export class ArtifactsRepository {
  constructor(private db: Database.Database) {}

  createArtifact(branchId: string, projectId: string, type: string, title: string, content: string): any {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO artifacts (id, branch_id, project_id, type, title, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, branchId, projectId, type, title, content, now, now);
    return { id, branchId, projectId, type, title, content, version: 1, createdAt: now };
  }

  /**
   * Persist a user-uploaded file as an artifact. The caller passes an explicit
   * `id` so the original bytes can be written to blobs/<id> BEFORE this row
   * exists — a failed blob write then leaves no dangling row, and a failed row
   * insert leaves only an orphan blob (swept later), never a row pointing at
   * nothing. `blobPath` is null when the extracted text IS the whole original
   * (plain-text uploads keep no separate copy).
   */
  createUploadedArtifact(fields: {
    id: string;
    branchId: string;
    projectId: string;
    type: string;
    title: string;
    content: string;
    originalFilename: string;
    mime: string;
    blobPath: string | null;
    byteSize: number;
    sha256: string;
  }): any {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO artifacts (id, branch_id, project_id, type, title, content, version, source, original_filename, mime, blob_path, byte_size, content_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'upload', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fields.id, fields.branchId, fields.projectId, fields.type, fields.title, fields.content,
      fields.originalFilename, fields.mime, fields.blobPath, fields.byteSize, fields.sha256, now, now,
    );
    return { id: fields.id, branchId: fields.branchId, projectId: fields.projectId, type: fields.type, title: fields.title, version: 1, createdAt: now };
  }

  /** Live uploaded artifact on this branch with these exact bytes, if any —
   * lets upload attach the existing artifact instead of duplicating it. */
  findUploadedArtifactBySha(branchId: string, sha256: string): { id: string; title: string } | undefined {
    const row = this.db.prepare(
      "SELECT id, title FROM artifacts WHERE branch_id = ? AND content_sha256 = ? AND deleted_at IS NULL LIMIT 1"
    ).get(branchId, sha256) as any;
    return row ? { id: row.id, title: row.title } : undefined;
  }

  /** Every blobs/<file> path some row still references (message images and
   * uploaded artifacts). Soft-deleted rows count as references — their blobs
   * must survive an undelete. Drives the startup orphan-blob sweep. */
  referencedBlobPaths(): Set<string> {
    const paths = new Set<string>();
    for (const r of this.db.prepare("SELECT blob_path FROM artifacts WHERE blob_path IS NOT NULL").all() as any[]) {
      paths.add(r.blob_path);
    }
    for (const r of this.db.prepare("SELECT images FROM messages WHERE images IS NOT NULL").all() as any[]) {
      try {
        for (const im of JSON.parse(r.images)) if (im?.blobPath) paths.add(im.blobPath);
      } catch { /* corrupt row — its images are unrenderable anyway */ }
    }
    return paths;
  }

  updateArtifact(id: string, content: string, title?: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE artifacts SET content = ?, title = COALESCE(?, title), version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(content, title ?? null, now, id);
  }

  getArtifact(id: string): any | undefined {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, branchId: row.branch_id, projectId: row.project_id, type: row.type, title: row.title, content: row.content, version: row.version, source: row.source ?? "extracted", originalFilename: row.original_filename ?? null, mime: row.mime ?? null, blobPath: row.blob_path ?? null, byteSize: row.byte_size ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listArtifacts(projectId: string): any[] {
    return (this.db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC").all(projectId) as any[])
      .map(r => ({ id: r.id, branchId: r.branch_id, projectId: r.project_id, type: r.type, title: r.title, version: r.version, source: r.source ?? "extracted", createdAt: r.created_at, updatedAt: r.updated_at }));
  }
}
