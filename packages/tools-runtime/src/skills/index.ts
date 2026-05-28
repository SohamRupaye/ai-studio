/**
 * Skills System - YAML frontmatter markdown skills with remote discovery,
 * per-agent permissions, and multi-location scanning
 */
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";

// Use native fs for glob scanning instead of external dependency
async function globScan(pattern: string, options: { cwd: string; absolute?: boolean; dot?: boolean }): Promise<string[]> {
  const { readdir } = fs;
  const results: string[] = [];
  const { cwd, dot } = options;

  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!dot && entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
        results.push(full);
      }
    }
  }

  await walk(cwd);
  return results;
}

// --- Types ---

export interface SkillInfo {
  name: string;
  description?: string;
  location: string;
  content: string;
}

export interface SkillPermission {
  allow?: string[];
  deny?: string[];
}

export interface SkillsConfig {
  paths?: string[];
  urls?: string[];
  disableExternal?: boolean;
}

interface RemoteIndex {
  skills: Array<{ name: string; files: string[] }>;
}

// --- YAML Frontmatter Parser ---

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const yaml = match[1];
  const content = match[2];
  // Simple YAML key: value parser (covers name, description)
  const data: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, content };
}

// --- Discovery ---

const SKILL_PATTERNS = ["**/SKILL.md", "**/*.skill.md"];
const EXTERNAL_DIRS = [".claude", ".agents", ".ai-studio"];
const CACHE_DIR = path.join(homedir(), ".cache", "ai-studio", "skills");

async function scanDir(dir: string, _pattern = "**/SKILL.md"): Promise<string[]> {
  try {
    return await globScan(_pattern, { cwd: dir, absolute: true, dot: true });
  } catch {
    return [];
  }
}

async function walkUp(from: string, targets: string[], stop?: string): Promise<string[]> {
  const found: string[] = [];
  let dir = from;
  while (dir !== path.dirname(dir)) {
    if (stop && dir === stop) break;
    for (const target of targets) {
      const candidate = path.join(dir, target);
      try {
        await fs.access(candidate);
        found.push(candidate);
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return found;
}

/** Fetch remote skill index and download skills to cache */
async function pullRemoteSkills(url: string): Promise<string[]> {
  const base = url.endsWith("/") ? url : `${url}/`;
  try {
    const resp = await fetch(new URL("index.json", base).href);
    if (!resp.ok) return [];
    const index = (await resp.json()) as RemoteIndex;

    await fs.mkdir(CACHE_DIR, { recursive: true });
    const dirs: string[] = [];

    await Promise.all(
      index.skills
        .filter((s) => s.files.includes("SKILL.md"))
        .map(async (skill) => {
          const skillDir = path.join(CACHE_DIR, skill.name);
          await fs.mkdir(skillDir, { recursive: true });
          await Promise.all(
            skill.files.map(async (file) => {
              const dest = path.join(skillDir, file);
              try { await fs.access(dest); return; } catch {} // already cached
              const fileUrl = new URL(`${skill.name}/${file}`, base).href;
              const r = await fetch(fileUrl);
              if (r.ok) await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
            }),
          );
          const md = path.join(skillDir, "SKILL.md");
          try { await fs.access(md); dirs.push(skillDir); } catch {}
        }),
    );
    return dirs;
  } catch {
    return [];
  }
}

// --- Main Service ---

export class SkillsService {
  private skills = new Map<string, SkillInfo>();
  private loaded = false;

  constructor(
    private projectDir: string,
    private config: SkillsConfig = {},
  ) {}

  /** Discover and load all skills from all locations */
  async load(): Promise<void> {
    this.skills.clear();

    // 1. Global external skills (unless disabled)
    if (!this.config.disableExternal) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(homedir(), dir, "skills");
        const matches = await scanDir(root);
        for (const m of matches) await this.addSkill(m);
      }

      // Walk up from project dir
      const externalDirs = await walkUp(this.projectDir, EXTERNAL_DIRS.map((d) => path.join(d, "skills")));
      for (const dir of externalDirs) {
        const matches = await scanDir(dir);
        for (const m of matches) await this.addSkill(m);
      }
    }

    // 2. Project-local skills
    const localPatterns = ["{skill,skills}/**/SKILL.md"];
    for (const pattern of localPatterns) {
      const matches = await scanDir(this.projectDir, pattern);
      for (const m of matches) await this.addSkill(m);
    }

    // 3. Configured paths
    for (const p of this.config.paths ?? []) {
      const expanded = p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;
      const abs = path.isAbsolute(expanded) ? expanded : path.join(this.projectDir, expanded);
      const matches = await scanDir(abs);
      for (const m of matches) await this.addSkill(m);
    }

    // 4. Remote URLs
    for (const url of this.config.urls ?? []) {
      const dirs = await pullRemoteSkills(url);
      for (const dir of dirs) {
        const matches = await scanDir(dir);
        for (const m of matches) await this.addSkill(m);
      }
    }

    this.loaded = true;
  }

  /** Get all skills, optionally filtered by agent permissions */
  all(permissions?: SkillPermission): SkillInfo[] {
    const list = Array.from(this.skills.values());
    if (!permissions) return list;
    return list.filter((s) => this.isAllowed(s.name, permissions));
  }

  /** Get a specific skill by name */
  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  /** Get a skill or throw */
  require(name: string): SkillInfo {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(
        `Skill "${name}" not found. Available: ${Array.from(this.skills.keys()).join(", ") || "none"}`,
      );
    }
    return skill;
  }

  /** Get skill directories (for file references) */
  dirs(): string[] {
    return Array.from(new Set(Array.from(this.skills.values()).map((s) => path.dirname(s.location))));
  }

  /** Format skills list for LLM consumption */
  format(permissions?: SkillPermission, verbose = false): string {
    const list = this.all(permissions).filter((s) => s.description);
    if (list.length === 0) return "No skills are currently available.";
    if (verbose) {
      return [
        "<available_skills>",
        ...list.map(
          (s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`,
        ),
        "</available_skills>",
      ].join("\n");
    }
    return ["## Available Skills", ...list.map((s) => `- **${s.name}**: ${s.description}`)].join("\n");
  }

  // --- Private ---

  private async addSkill(filePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { data, content } = parseFrontmatter(raw);
      if (typeof data.name !== "string") return;
      if (this.skills.has(data.name)) return; // first match wins (priority order)
      this.skills.set(data.name, {
        name: data.name,
        description: typeof data.description === "string" ? data.description : undefined,
        location: filePath,
        content,
      });
    } catch {}
  }

  private isAllowed(name: string, permissions: SkillPermission): boolean {
    if (permissions.deny?.includes(name) || permissions.deny?.includes("*")) return false;
    if (permissions.allow && !permissions.allow.includes(name) && !permissions.allow.includes("*")) return false;
    return true;
  }
}
