/**
 * Permission Persistence - "Always allow" decisions saved across sessions
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

export interface PermissionRule {
  tool: string;
  pattern?: string; // glob pattern for paths
  decision: "allow" | "deny";
  scope: "global" | "project" | "session";
  createdAt: number;
}

const PERMISSIONS_FILE = "permissions.json";

export class PermissionStore {
  private rules: PermissionRule[] = [];
  private filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? path.join(homedir(), ".ai-studio");
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, PERMISSIONS_FILE);
    this.load();
  }

  /** Check if a tool+pattern is already allowed */
  isAllowed(tool: string, pattern?: string): boolean | null {
    for (const rule of this.rules) {
      if (rule.tool !== tool && rule.tool !== "*") continue;
      if (rule.pattern && pattern && !this.matchPattern(rule.pattern, pattern)) continue;
      return rule.decision === "allow";
    }
    return null; // no rule found, must ask
  }

  /** Record a permission decision */
  save(tool: string, decision: "allow" | "deny", opts?: { pattern?: string; scope?: PermissionRule["scope"] }): void {
    // Remove conflicting rules
    this.rules = this.rules.filter(r => !(r.tool === tool && r.pattern === opts?.pattern));
    this.rules.push({ tool, pattern: opts?.pattern, decision, scope: opts?.scope ?? "global", createdAt: Date.now() });
    this.persist();
  }

  /** Get all rules */
  list(): PermissionRule[] {
    return [...this.rules];
  }

  /** Remove a rule */
  remove(tool: string, pattern?: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => !(r.tool === tool && r.pattern === pattern));
    if (this.rules.length !== before) { this.persist(); return true; }
    return false;
  }

  /** Clear all rules */
  clear(): void {
    this.rules = [];
    this.persist();
  }

  private matchPattern(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
    return pattern === value;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try { this.rules = JSON.parse(fs.readFileSync(this.filePath, "utf-8")); } catch { this.rules = []; }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.rules, null, 2));
  }
}
