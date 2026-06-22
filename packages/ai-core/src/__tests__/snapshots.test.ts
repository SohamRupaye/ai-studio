import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SnapshotManager } from "../snapshots.js";

let tmpDir: string;
let manager: SnapshotManager;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "snapshots-test-"));
  manager = new SnapshotManager();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SnapshotManager", () => {
  it("startTracking then commit with no records → null", () => {
    manager.startTracking("session1");
    const snap = manager.commit("session1");
    expect(snap).toBeNull();
  });

  it("record existing file, modify it, commit → snapshot appears in list()", () => {
    const filePath = join(tmpDir, "file.txt");
    writeFileSync(filePath, "original content");

    manager.startTracking("session1");
    manager.recordBefore("session1", filePath);

    writeFileSync(filePath, "modified content");

    const snap = manager.commit("session1");
    expect(snap).not.toBeNull();
    expect(snap!.sessionId).toBe("session1");

    const snaps = manager.list("session1");
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.id).toBe(snap!.id);
  });

  it("revert snapshot restores original content", () => {
    const filePath = join(tmpDir, "revert.txt");
    writeFileSync(filePath, "original");

    manager.startTracking("session1");
    manager.recordBefore("session1", filePath);
    writeFileSync(filePath, "changed");

    const snap = manager.commit("session1")!;
    const { reverted, errors } = manager.revert(snap.id);

    expect(errors).toHaveLength(0);
    expect(reverted).toContain(filePath);
    expect(readFileSync(filePath, "utf-8")).toBe("original");
  });

  it("revert of new file (originalContent=null) deletes the file", () => {
    const filePath = join(tmpDir, "new-file.txt");

    manager.startTracking("session1");
    manager.recordBefore("session1", filePath); // file doesn't exist yet → originalContent=null

    writeFileSync(filePath, "newly created");

    const snap = manager.commit("session1")!;
    const { reverted, errors } = manager.revert(snap.id);

    expect(errors).toHaveLength(0);
    expect(reverted).toContain(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it("diff() returns correct action per file", () => {
    const existingFile = join(tmpDir, "existing.txt");
    const newFile = join(tmpDir, "new.txt");
    writeFileSync(existingFile, "existing content");

    manager.startTracking("session1");
    manager.recordBefore("session1", existingFile); // restore
    manager.recordBefore("session1", newFile);       // delete (new file)

    writeFileSync(existingFile, "changed");
    writeFileSync(newFile, "new");

    const snap = manager.commit("session1")!;
    const diffs = manager.diff(snap.id);

    const existingDiff = diffs.find(d => d.path === existingFile);
    const newDiff = diffs.find(d => d.path === newFile);

    expect(existingDiff).toBeDefined();
    expect(existingDiff!.action).toBe("restore");

    expect(newDiff).toBeDefined();
    expect(newDiff!.action).toBe("delete");
  });

  it("same file recorded twice in one session → only one entry (dedup)", () => {
    const filePath = join(tmpDir, "dedup.txt");
    writeFileSync(filePath, "content");

    manager.startTracking("session1");
    manager.recordBefore("session1", filePath);
    manager.recordBefore("session1", filePath); // duplicate

    writeFileSync(filePath, "changed");
    const snap = manager.commit("session1")!;

    expect(snap.files).toHaveLength(1);
  });

  it("unknown snapshotId in revert → { reverted: [], errors: ['Snapshot not found'] }", () => {
    const result = manager.revert("nonexistent-snapshot-id");
    expect(result.reverted).toHaveLength(0);
    expect(result.errors).toContain("Snapshot not found");
  });

  it("multiple sessions tracked independently", () => {
    const file1 = join(tmpDir, "session1.txt");
    const file2 = join(tmpDir, "session2.txt");
    writeFileSync(file1, "s1");
    writeFileSync(file2, "s2");

    manager.startTracking("sessionA");
    manager.recordBefore("sessionA", file1);
    writeFileSync(file1, "changed");
    const snapA = manager.commit("sessionA")!;

    manager.startTracking("sessionB");
    manager.recordBefore("sessionB", file2);
    writeFileSync(file2, "changed");
    const snapB = manager.commit("sessionB")!;

    expect(manager.list("sessionA")).toHaveLength(1);
    expect(manager.list("sessionB")).toHaveLength(1);
    expect(snapA.sessionId).toBe("sessionA");
    expect(snapB.sessionId).toBe("sessionB");
    expect(manager.list("sessionA")[0]!.id).not.toBe(manager.list("sessionB")[0]!.id);
  });

  it("commit gives snapshot a unique id string", () => {
    const filePath = join(tmpDir, "f.txt");
    writeFileSync(filePath, "x");
    manager.startTracking("s");
    manager.recordBefore("s", filePath);
    writeFileSync(filePath, "y");
    const snap = manager.commit("s")!;
    expect(typeof snap.id).toBe("string");
    expect(snap.id.length).toBeGreaterThan(0);
  });

  it("commit with description stores description on snapshot", () => {
    const filePath = join(tmpDir, "f.txt");
    writeFileSync(filePath, "x");
    manager.startTracking("s");
    manager.recordBefore("s", filePath);
    writeFileSync(filePath, "y");
    const snap = manager.commit("s", "my description")!;
    expect(snap.description).toBe("my description");
  });
});
