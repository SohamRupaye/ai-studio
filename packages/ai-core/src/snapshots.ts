/**
 * Snapshot/Revert - Track file changes made by the agent and support atomic undo
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface FileSnapshot {
  path: string;
  originalContent: string | null; // null = file didn't exist before
  timestamp: number;
}

export interface SessionSnapshot {
  id: string;
  sessionId: string;
  files: FileSnapshot[];
  createdAt: number;
  description?: string;
}

export class SnapshotManager {
  private snapshots = new Map<string, SessionSnapshot[]>();
  private pendingChanges = new Map<string, FileSnapshot[]>(); // sessionId → changes being tracked

  /** Start tracking changes for a session */
  startTracking(sessionId: string): void {
    if (!this.pendingChanges.has(sessionId)) this.pendingChanges.set(sessionId, []);
  }

  /** Record a file before it gets modified (call before write/edit) */
  recordBefore(sessionId: string, filePath: string): void {
    const changes = this.pendingChanges.get(sessionId);
    if (!changes) return;
    // Don't record same file twice
    if (changes.some(c => c.path === filePath)) return;
    let originalContent: string | null = null;
    try { originalContent = fs.readFileSync(filePath, "utf-8"); } catch { /* new file */ }
    changes.push({ path: filePath, originalContent, timestamp: Date.now() });
  }

  /** Commit pending changes as a snapshot */
  commit(sessionId: string, description?: string): SessionSnapshot | null {
    const changes = this.pendingChanges.get(sessionId);
    if (!changes?.length) return null;
    const snapshot: SessionSnapshot = {
      id: crypto.randomUUID(),
      sessionId,
      files: [...changes],
      createdAt: Date.now(),
      description,
    };
    if (!this.snapshots.has(sessionId)) this.snapshots.set(sessionId, []);
    this.snapshots.get(sessionId)!.push(snapshot);
    this.pendingChanges.set(sessionId, []);
    return snapshot;
  }

  /** Revert a snapshot - restore all files to their pre-change state */
  revert(snapshotId: string): { reverted: string[]; errors: string[] } {
    const reverted: string[] = [];
    const errors: string[] = [];

    for (const [, snaps] of this.snapshots) {
      const idx = snaps.findIndex(s => s.id === snapshotId);
      if (idx === -1) continue;
      const snapshot = snaps[idx]!;

      for (const file of snapshot.files) {
        try {
          if (file.originalContent === null) {
            // File was created by agent — delete it
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } else {
            // Restore original content
            fs.mkdirSync(path.dirname(file.path), { recursive: true });
            fs.writeFileSync(file.path, file.originalContent);
          }
          reverted.push(file.path);
        } catch (err) {
          errors.push(`${file.path}: ${err}`);
        }
      }

      // Remove this and all subsequent snapshots
      snaps.splice(idx);
      return { reverted, errors };
    }
    return { reverted: [], errors: ["Snapshot not found"] };
  }

  /** List snapshots for a session */
  list(sessionId: string): SessionSnapshot[] {
    return this.snapshots.get(sessionId) ?? [];
  }

  /** Get diff for a snapshot (what would revert change) */
  diff(snapshotId: string): Array<{ path: string; action: "restore" | "delete" }> {
    for (const [, snaps] of this.snapshots) {
      const snapshot = snaps.find(s => s.id === snapshotId);
      if (!snapshot) continue;
      return snapshot.files.map(f => ({
        path: f.path,
        action: f.originalContent === null ? "delete" : "restore",
      }));
    }
    return [];
  }

  /** Use git stash as an alternative snapshot mechanism (if in a git repo) */
  static gitSnapshot(cwd: string, message?: string): string | null {
    try {
      execSync("git add -A", { cwd, stdio: "pipe" });
      execSync(`git stash push -m "${message ?? "ai-studio-snapshot"}"`, { cwd, stdio: "pipe" });
      return execSync("git stash list --max-count=1 --format=%H", { cwd, encoding: "utf-8" }).trim();
    } catch { return null; }
  }

  /** Revert using git stash pop */
  static gitRevert(cwd: string): boolean {
    try { execSync("git stash pop", { cwd, stdio: "pipe" }); return true; } catch { return false; }
  }
}
