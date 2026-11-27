/**
 * Skills — reusable instruction packages in the ecosystem-standard format:
 * a directory holding a SKILL.md with YAML frontmatter (`name`, `description`)
 * and a markdown body, plus optional supporting files referenced relatively.
 *
 * The app manages ONE skills directory (<dataDir>/skills/<name>/SKILL.md).
 * Skills arrive by import (a local folder or .md file) or by URL (a raw
 * SKILL.md, or a catalogue index.json listing skills to download); both
 * validate before installing. Enable/disable lives OUTSIDE this service
 * (config.yaml `disabled_skills`) — callers pass the disabled list as a
 * `deny` permission when filtering.
 */
import * as fs from "fs/promises";
import { watch, type FSWatcher } from "node:fs";
import * as path from "path";

// --- Types ---

export interface SkillInfo {
  name: string;
  description?: string;
  /** Absolute path of the SKILL.md file. */
  location: string;
  /** Markdown body with the frontmatter stripped. */
  content: string;
  /** Frontmatter `disable-model-invocation: true` — the skill is slash-only:
   * never advertised to the model, only the user invokes it. */
  userOnly?: boolean;
}

export interface SkillPermission {
  allow?: string[];
  deny?: string[];
}

export interface SkillImportResult {
  imported: string[];
  skipped: Array<{ source: string; reason: string }>;
}

/** A skill found at a URL but not yet installed — enough to install it
 * without re-walking the source. */
export interface DiscoveredSkill {
  name: string;
  description?: string;
  /** Where it came from (repo directory or URL) — display only. */
  source: string;
  /** Every file in the skill's folder, SKILL.md included. */
  files: Array<{ rel: string; url: string }>;
  /** SKILL.md text, already fetched and validated during discovery. */
  skillMd: string;
}

export interface SkillDiscovery {
  skills: DiscoveredSkill[];
  skipped: Array<{ source: string; reason: string }>;
}

export interface SkillsServiceOptions {
  /** Test seams — default to the real GitHub endpoints. */
  githubApiBase?: string;
  githubRawBase?: string;
}

interface RemoteIndex {
  skills: Array<{ name: string; files: string[] }>;
}

/** Skills repos are how the ecosystem ships skills (skills.sh, `npx skills
 * add owner/repo --skill name`) — accept the URL shapes people actually paste. */
function parseGitHubUrl(
  input: string,
): { owner: string; repo: string; branch?: string; subpath?: string } | null {
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(input.trim());
  if (shorthand) return { owner: shorthand[1]!, repo: shorthand[2]! };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const owner = segs[0]!;
  const repo = segs[1]!.replace(/\.git$/, "");
  // /tree/<branch>/<subpath…> and /blob/<branch>/<path-to-file>. Branch names
  // containing "/" misparse here — acceptable for pasted skill-repo links.
  if ((segs[2] === "tree" || segs[2] === "blob") && segs[3]) {
    let subpath = segs.slice(4).join("/");
    if (segs[2] === "blob" && subpath.endsWith("SKILL.md")) {
      subpath = subpath.split("/").slice(0, -1).join("/");
    }
    return { owner, repo, branch: segs[3], subpath: subpath || undefined };
  }
  return { owner, repo };
}

const MAX_SKILL_FILES = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DISCOVERED = 50;

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

// --- Parsing ---

/** Skill names double as directory names and slash commands — keep them safe for both. */
const NAME_PATTERN = /^[A-Za-z0-9][\w-]*$/;

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const data: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon);
    const val = line.slice(colon + 1).trim();
    if (/^\w[\w-]*$/.test(key) && val.length > 0) {
      data[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return { data, content: match[2]! };
}

/**
 * Parse and validate SKILL.md text. Every install path (import, URL, load)
 * goes through this, so a skill that loads is a skill that validated.
 */
export function parseSkillFile(
  raw: string,
): { ok: true; name: string; description?: string; content: string; userOnly?: boolean } | { ok: false; reason: string } {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return { ok: false, reason: "No YAML frontmatter (expected --- name: … --- at the top)." };
  const name = parsed.data["name"];
  if (!name) return { ok: false, reason: "Frontmatter is missing a `name`." };
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, reason: `Skill name "${name}" must be letters, digits, hyphens or underscores.` };
  }
  return {
    ok: true,
    name,
    description: parsed.data["description"],
    content: parsed.content.trim(),
    userOnly: parsed.data["disable-model-invocation"] === "true" || undefined,
  };
}

// --- Discovery ---

/** All SKILL.md / *.skill.md files under dir, deterministic order. */
async function scanForSkillFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(full);
      } else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

// --- Service ---

export class SkillsService {
  private skills = new Map<string, SkillInfo>();
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private skillsDir: string,
    private opts: SkillsServiceOptions = {},
  ) {}

  dir(): string {
    return this.skillsDir;
  }

  /** (Re)scan the skills directory. First match wins on a name collision. */
  async load(): Promise<void> {
    const next = new Map<string, SkillInfo>();
    for (const file of await scanForSkillFiles(this.skillsDir)) {
      try {
        const parsed = parseSkillFile(await fs.readFile(file, "utf-8"));
        if (!parsed.ok || next.has(parsed.name)) continue;
        next.set(parsed.name, {
          name: parsed.name,
          description: parsed.description,
          location: file,
          content: parsed.content,
          userOnly: parsed.userOnly,
        });
      } catch {}
    }
    this.skills = next;
  }

  /** All skills sorted by name, optionally filtered (deny doubles as the disabled list). */
  all(permissions?: SkillPermission): SkillInfo[] {
    const list = Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!permissions) return list;
    return list.filter((s) => this.isAllowed(s.name, permissions));
  }

  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  require(name: string): SkillInfo {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found. Available: ${Array.from(this.skills.keys()).join(", ") || "none"}`);
    }
    return skill;
  }

  /** Render the skills list for LLM consumption — described skills only, and
   * never slash-only ones (`disable-model-invocation`). */
  format(permissions?: SkillPermission, verbose = false): string {
    const list = this.all(permissions).filter((s) => s.description && !s.userOnly);
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

  /**
   * Install a skill from disk: a directory containing SKILL.md (copied whole,
   * supporting files included) or a single .md file. Validates before any
   * write; throws with a user-facing reason on invalid input or a name
   * collision. Returns the installed skill's name.
   */
  async importFromPath(src: string): Promise<string> {
    let raw: string;
    try {
      raw = await fs.readFile(src, "utf-8");
    } catch (err: any) {
      if (err?.code === "EISDIR") {
        const mdPath = path.join(src, "SKILL.md");
        const dirRaw = await fs.readFile(mdPath, "utf-8").catch(() => null);
        if (dirRaw === null) throw new Error("Folder has no SKILL.md.");
        const parsed = parseSkillFile(dirRaw);
        if (!parsed.ok) throw new Error(parsed.reason);
        const dest = await this.claimDir(parsed.name);
        await fs.cp(src, dest, { recursive: true });
        await this.load();
        return parsed.name;
      }
      throw new Error("File or folder not found.");
    }

    const parsed = parseSkillFile(raw);
    if (!parsed.ok) throw new Error(parsed.reason);
    const dest = await this.claimDir(parsed.name);
    await fs.writeFile(path.join(dest, "SKILL.md"), raw);
    await this.load();
    return parsed.name;
  }

  /**
   * Find installable skills at a URL WITHOUT installing. Three source shapes,
   * one result: a GitHub repo (the ecosystem's distribution unit — every
   * SKILL.md folder in the tree is a candidate), a raw SKILL.md file, or a
   * catalogue directory serving index.json. Every candidate's SKILL.md is
   * fetched and validated here, so the picker shows real names/descriptions
   * and install can't discover something different. Per-candidate problems
   * land in `skipped`; only an unreachable/unusable URL throws.
   */
  async discoverFromUrl(url: string): Promise<SkillDiscovery> {
    const github = parseGitHubUrl(url);
    if (github) return this.discoverGitHub(github);

    const resp = await fetch(url).catch(() => null);
    if (resp?.ok) {
      const text = await resp.text();
      const parsed = parseSkillFile(text);
      if (parsed.ok) {
        return {
          skills: [
            {
              name: parsed.name,
              description: parsed.description,
              source: url,
              files: [{ rel: "SKILL.md", url }],
              skillMd: text,
            },
          ],
          skipped: [],
        };
      }
      // Not a skill file — fall through to the catalogue shape unless the URL
      // explicitly pointed at markdown, in which case the parse error is the answer.
      if (/\.md($|\?)/.test(url)) throw new Error(parsed.reason);
    }
    return this.discoverCatalogue(url);
  }

  /**
   * Install skills from a URL. `pick` narrows to specific names (the
   * `--skill` of `npx skills add`); omitted installs everything discovered.
   * Per-skill failures are reported, not thrown.
   */
  async importFromUrl(url: string, pick?: string[]): Promise<SkillImportResult> {
    const { skills: found, skipped } = await this.discoverFromUrl(url);
    const result: SkillImportResult = { imported: [], skipped: [...skipped] };

    let chosen = found;
    if (pick?.length) {
      const byName = new Map(found.map((s) => [s.name, s]));
      chosen = [];
      for (const name of pick) {
        const skill = byName.get(name);
        if (skill) chosen.push(skill);
        else result.skipped.push({ source: name, reason: "Not found at that URL." });
      }
    }

    for (const skill of chosen) {
      try {
        await this.installDiscovered(skill);
        result.imported.push(skill.name);
      } catch (err) {
        result.skipped.push({
          source: skill.name,
          reason: err instanceof Error ? err.message : "Install failed.",
        });
      }
    }
    await this.load();
    return result;
  }

  /**
   * Delete an installed skill from disk. Removes the skill's top-level
   * directory under the skills dir (a flat *.skill.md removes just the file).
   */
  async remove(name: string): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill) return false;
    const rel = path.relative(this.skillsDir, skill.location);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // never delete outside the managed dir
    const topSegment = rel.split(path.sep)[0]!;
    const target = path.join(this.skillsDir, topSegment);
    await fs.rm(target, { recursive: true, force: true });
    await this.load();
    return true;
  }

  /**
   * Watch the skills directory and reload on changes (debounced) — external
   * edits show up without a restart, same pattern as watchToolDirectories.
   */
  async startWatching(onChange: () => void): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    if (this.watcher) return;
    try {
      this.watcher = watch(this.skillsDir, { recursive: true }, () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.load().then(onChange).catch(() => {});
        }, 500);
      });
    } catch {
      // Watching is best-effort (recursive watch is unsupported on some
      // platforms) — mutations through the service reload explicitly anyway.
    }
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  // --- Private ---

  /**
   * GitHub discovery: default-branch lookup → recursive tree → each in-scope
   * SKILL.md folder becomes a candidate carrying ALL its files (a nested
   * folder with its own SKILL.md belongs to that other skill and is excluded).
   * Unauthenticated API calls — public repos only, and the 403 rate-limit
   * answer gets a human message.
   */
  private async discoverGitHub(gh: {
    owner: string;
    repo: string;
    branch?: string;
    subpath?: string;
  }): Promise<SkillDiscovery> {
    const api = this.opts.githubApiBase ?? "https://api.github.com";
    const raw = this.opts.githubRawBase ?? "https://raw.githubusercontent.com";
    const explain = (status: number): string =>
      status === 403
        ? "GitHub API rate limit reached — try again in a few minutes."
        : status === 404
          ? "Repository not found (private repositories aren't supported)."
          : `GitHub returned HTTP ${status}.`;

    let branch = gh.branch;
    if (!branch) {
      const r = await fetch(`${api}/repos/${gh.owner}/${gh.repo}`).catch(() => null);
      if (!r?.ok) throw new Error(explain(r?.status ?? 0));
      branch = ((await r.json()) as { default_branch?: string }).default_branch ?? "main";
    }

    const treeResp = await fetch(
      `${api}/repos/${gh.owner}/${gh.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    ).catch(() => null);
    if (!treeResp?.ok) throw new Error(explain(treeResp?.status ?? 0));
    const tree = ((await treeResp.json()) as { tree?: Array<{ path: string; type: string; size?: number }> }).tree;
    if (!Array.isArray(tree)) throw new Error("GitHub returned an unexpected tree response.");

    const blobs = tree.filter((t) => t.type === "blob");
    const inScope = (p: string) => !gh.subpath || p === gh.subpath || p.startsWith(`${gh.subpath}/`);
    const rawUrl = (p: string) => `${raw}/${gh.owner}/${gh.repo}/${encodeURIComponent(branch!)}/${encodePath(p)}`;
    // "" for a repo-root skill, else "dir/" — everything under it is the skill's.
    const skillPrefixes = blobs
      .filter((b) => inScope(b.path) && (b.path === "SKILL.md" || b.path.endsWith("/SKILL.md")))
      .map((b) => b.path.slice(0, -"SKILL.md".length));

    const discovery: SkillDiscovery = { skills: [], skipped: [] };
    if (skillPrefixes.length > MAX_DISCOVERED) {
      discovery.skipped.push({
        source: `${gh.owner}/${gh.repo}`,
        reason: `Repository has ${skillPrefixes.length} skills — only the first ${MAX_DISCOVERED} were considered.`,
      });
    }

    for (const prefix of skillPrefixes.slice(0, MAX_DISCOVERED)) {
      const sourceName = prefix ? prefix.replace(/\/$/, "") : `${gh.owner}/${gh.repo}`;
      const mdResp = await fetch(rawUrl(`${prefix}SKILL.md`)).catch(() => null);
      if (!mdResp?.ok) {
        discovery.skipped.push({ source: sourceName, reason: `Couldn't download SKILL.md (HTTP ${mdResp?.status ?? "error"}).` });
        continue;
      }
      const text = await mdResp.text();
      const parsed = parseSkillFile(text);
      if (!parsed.ok) {
        discovery.skipped.push({ source: sourceName, reason: parsed.reason });
        continue;
      }
      const nested = skillPrefixes.filter((other) => other !== prefix && other.startsWith(prefix));
      const files = blobs
        .filter((b) => b.path.startsWith(prefix) && !nested.some((n) => b.path.startsWith(n)))
        .map((b) => ({ rel: b.path.slice(prefix.length), url: rawUrl(b.path), size: b.size }));
      if (files.length > MAX_SKILL_FILES) {
        discovery.skipped.push({ source: parsed.name, reason: `Skill folder has ${files.length} files (max ${MAX_SKILL_FILES}).` });
        continue;
      }
      const oversized = files.find((f) => (f.size ?? 0) > MAX_FILE_BYTES);
      if (oversized) {
        discovery.skipped.push({ source: parsed.name, reason: `"${oversized.rel}" exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB.` });
        continue;
      }
      discovery.skills.push({
        name: parsed.name,
        description: parsed.description,
        source: sourceName,
        files: files.map(({ rel, url }) => ({ rel, url })),
        skillMd: text,
      });
    }

    if (!discovery.skills.length && !discovery.skipped.length) {
      throw new Error("No SKILL.md found in that repository.");
    }
    return discovery;
  }

  /** index.json catalogue ({skills: [{name, files}]}) → discovery shape. */
  private async discoverCatalogue(url: string): Promise<SkillDiscovery> {
    const base = url.endsWith("/") ? url : `${url}/`;
    const indexResp = await fetch(new URL("index.json", base).href).catch(() => null);
    if (!indexResp?.ok) {
      throw new Error("URL is neither a GitHub repository, a SKILL.md file, nor a skill catalogue (no index.json).");
    }
    let index: RemoteIndex;
    try {
      index = (await indexResp.json()) as RemoteIndex;
      if (!Array.isArray(index.skills)) throw new Error();
    } catch {
      throw new Error("Catalogue index.json is malformed (expected {skills: [{name, files}]}).");
    }

    const discovery: SkillDiscovery = { skills: [], skipped: [] };
    for (const entry of index.skills.slice(0, MAX_DISCOVERED)) {
      // Names and file paths come from the network — refuse anything that
      // could escape the skills directory.
      if (!NAME_PATTERN.test(entry.name ?? "")) {
        discovery.skipped.push({ source: String(entry.name), reason: "Invalid skill name in catalogue." });
        continue;
      }
      const files = (entry.files ?? []).filter(
        (f) => typeof f === "string" && !path.isAbsolute(f) && !f.split(/[\\/]/).includes(".."),
      );
      if (!files.includes("SKILL.md")) {
        discovery.skipped.push({ source: entry.name, reason: "Catalogue entry has no SKILL.md." });
        continue;
      }
      const fileUrl = (f: string) => new URL(`${entry.name}/${f}`, base).href;
      const mdResp = await fetch(fileUrl("SKILL.md")).catch(() => null);
      if (!mdResp?.ok) {
        discovery.skipped.push({ source: entry.name, reason: `Couldn't download SKILL.md (HTTP ${mdResp?.status ?? "error"}).` });
        continue;
      }
      const text = await mdResp.text();
      const parsed = parseSkillFile(text);
      if (!parsed.ok) {
        discovery.skipped.push({ source: entry.name, reason: parsed.reason });
        continue;
      }
      if (parsed.name !== entry.name) {
        discovery.skipped.push({ source: entry.name, reason: `SKILL.md names itself "${parsed.name}", not "${entry.name}".` });
        continue;
      }
      discovery.skills.push({
        name: parsed.name,
        description: parsed.description,
        source: entry.name,
        files: files.map((f) => ({ rel: f, url: fileUrl(f) })),
        skillMd: text,
      });
    }
    return discovery;
  }

  /** Write one discovered skill to disk; cleans up after itself on failure. */
  private async installDiscovered(skill: DiscoveredSkill): Promise<void> {
    const dest = await this.claimDir(skill.name);
    try {
      await fs.writeFile(path.join(dest, "SKILL.md"), skill.skillMd);
      for (const file of skill.files) {
        if (file.rel === "SKILL.md") continue; // already written from the validated text
        const r = await fetch(file.url);
        if (!r.ok) throw new Error(`Couldn't download ${file.rel} (HTTP ${r.status}).`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error(`"${file.rel}" exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
        }
        const resolvedDest = path.resolve(dest);
        const filePath = path.resolve(dest, file.rel);
        if (filePath !== resolvedDest && !filePath.startsWith(resolvedDest + path.sep)) {
          throw new Error(`Invalid file path "${file.rel}".`);
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes);
      }
    } catch (err) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  /** Reserve <skillsDir>/<name> for a new install; throws if the name is taken. */
  private async claimDir(name: string): Promise<string> {
    if (this.skills.has(name)) throw new Error(`A skill named "${name}" is already installed.`);
    await fs.mkdir(this.skillsDir, { recursive: true });
    const dest = path.join(this.skillsDir, name);
    try {
      await fs.mkdir(dest);
    } catch (err: any) {
      if (err?.code === "EEXIST") throw new Error(`A skill named "${name}" is already installed.`);
      throw err;
    }
    return dest;
  }

  private isAllowed(name: string, permissions: SkillPermission): boolean {
    if (permissions.deny?.includes(name) || permissions.deny?.includes("*")) return false;
    if (permissions.allow && !permissions.allow.includes(name) && !permissions.allow.includes("*")) return false;
    return true;
  }
}
