import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PermissionStore } from "../permissions.js";

let tmpDir: string;
let store: PermissionStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "permissions-test-"));
  store = new PermissionStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PermissionStore", () => {
  it("fresh store: isAllowed() returns null (no rule)", () => {
    expect(store.isAllowed("bash")).toBeNull();
  });

  it("save('allow') → isAllowed returns true", () => {
    store.save("bash", "allow");
    expect(store.isAllowed("bash")).toBe(true);
  });

  it("save('deny') → isAllowed returns false", () => {
    store.save("bash", "deny");
    expect(store.isAllowed("bash")).toBe(false);
  });

  it("save with pattern → isAllowed with matching path returns true", () => {
    store.save("read_file", "allow", { pattern: "/home/*" });
    expect(store.isAllowed("read_file", "/home/foo")).toBe(true);
  });

  it("isAllowed with non-matching pattern → null (no rule)", () => {
    store.save("read_file", "allow", { pattern: "/home/*" });
    expect(store.isAllowed("read_file", "/etc/passwd")).toBeNull();
  });

  it("save same tool+pattern twice → second overwrites first (only one rule)", () => {
    store.save("bash", "allow");
    store.save("bash", "deny");
    expect(store.list()).toHaveLength(1);
    expect(store.isAllowed("bash")).toBe(false);
  });

  it("save same tool+pattern combination removes previous conflicting rule", () => {
    store.save("read_file", "allow", { pattern: "/home/*" });
    store.save("read_file", "deny", { pattern: "/home/*" });
    const rules = store.list().filter(r => r.tool === "read_file" && r.pattern === "/home/*");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.decision).toBe("deny");
  });

  it("remove existing rule → true; isAllowed → null", () => {
    store.save("bash", "allow");
    expect(store.remove("bash")).toBe(true);
    expect(store.isAllowed("bash")).toBeNull();
  });

  it("remove nonexistent rule → false", () => {
    expect(store.remove("nonexistent_tool")).toBe(false);
  });

  it("clear() empties all rules", () => {
    store.save("bash", "allow");
    store.save("read_file", "deny");
    store.clear();
    expect(store.list()).toHaveLength(0);
  });

  it("persists rules across instances", () => {
    store.save("bash", "allow");
    const store2 = new PermissionStore(tmpDir);
    expect(store2.isAllowed("bash")).toBe(true);
  });

  it("pattern '*' matches any value", () => {
    store.save("bash", "allow", { pattern: "*" });
    expect(store.isAllowed("bash", "anything")).toBe(true);
    expect(store.isAllowed("bash", "/etc/passwd")).toBe(true);
    expect(store.isAllowed("bash", "")).toBe(true);
  });

  it("exact pattern match works", () => {
    store.save("read_file", "allow", { pattern: "/exact/path.ts" });
    expect(store.isAllowed("read_file", "/exact/path.ts")).toBe(true);
    expect(store.isAllowed("read_file", "/exact/path.ts/extra")).toBeNull();
  });

  it("list() returns all saved rules", () => {
    store.save("bash", "allow");
    store.save("read_file", "deny", { pattern: "/home/*" });
    const rules = store.list();
    expect(rules).toHaveLength(2);
    expect(rules.some(r => r.tool === "bash" && r.decision === "allow")).toBe(true);
    expect(rules.some(r => r.tool === "read_file" && r.decision === "deny")).toBe(true);
  });
});
