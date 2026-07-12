import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SkillsService, parseSkillFile } from "../../skills/index.js";

let root: string;
let skillsDir: string;
let dirCounter = 0;

beforeEach(async () => {
  root = join(tmpdir(), `skills-svc-${process.pid}-${Date.now()}-${++dirCounter}`);
  skillsDir = join(root, "skills");
  mkdirSync(skillsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const md = (name: string, description = "Does a thing.", body = "Step 1. Step 2.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

/** Install a skill directly into the managed dir (as import would lay it out). */
function installSkill(name: string, content = md(name)): void {
  mkdirSync(join(skillsDir, name), { recursive: true });
  writeFileSync(join(skillsDir, name, "SKILL.md"), content);
}

// ---------------------------------------------------------------------------
// parseSkillFile
// ---------------------------------------------------------------------------

describe("parseSkillFile", () => {
  it("parses name, description and body", () => {
    const parsed = parseSkillFile(md("my-skill", "Useful.", "Do the work."));
    expect(parsed).toEqual({ ok: true, name: "my-skill", description: "Useful.", content: "Do the work." });
  });

  it("rejects text without frontmatter", () => {
    const parsed = parseSkillFile("# Just markdown\n\nNo frontmatter here.");
    expect(parsed.ok).toBe(false);
  });

  it("rejects frontmatter without a name", () => {
    const parsed = parseSkillFile("---\ndescription: nameless\n---\nBody");
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining("name") });
  });

  it("rejects unsafe names (spaces, slashes, dot-leading)", () => {
    for (const bad of ["two words", "a/b", "../up", ".hidden"]) {
      expect(parseSkillFile(md(bad)).ok, bad).toBe(false);
    }
  });

  it("strips quotes and tolerates colons in the description", () => {
    const parsed = parseSkillFile(`---\nname: q\ndescription: "Use when: things happen"\n---\nB`);
    expect(parsed).toMatchObject({ ok: true, description: "Use when: things happen" });
  });
});

// ---------------------------------------------------------------------------
// load / all / get / format
// ---------------------------------------------------------------------------

describe("SkillsService discovery", () => {
  it("loads <dir>/<name>/SKILL.md and flat *.skill.md files", async () => {
    installSkill("alpha");
    writeFileSync(join(skillsDir, "beta.skill.md"), md("beta"));
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.all().map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(svc.get("alpha")?.content).toContain("Step 1");
  });

  it("skips files that fail validation without dropping the rest", async () => {
    installSkill("good");
    installSkill("bad", "# no frontmatter at all");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.all().map((s) => s.name)).toEqual(["good"]);
  });

  it("first match wins on a duplicate name", async () => {
    installSkill("dupe", md("dupe", "first"));
    mkdirSync(join(skillsDir, "zz-later"), { recursive: true });
    writeFileSync(join(skillsDir, "zz-later", "SKILL.md"), md("dupe", "second"));
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.all()).toHaveLength(1);
    expect(svc.get("dupe")?.description).toBe("first");
  });

  it("deny permissions filter all() — the disabled-list mechanism", async () => {
    installSkill("kept");
    installSkill("hidden");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.all({ deny: ["hidden"] }).map((s) => s.name)).toEqual(["kept"]);
  });

  it("format(verbose) emits <available_skills> and omits undescribed skills", async () => {
    installSkill("described");
    installSkill("mute", "---\nname: mute\n---\nBody only.");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    const xml = svc.format(undefined, true);
    expect(xml).toContain("<available_skills>");
    expect(xml).toContain("<name>described</name>");
    expect(xml).not.toContain("mute");
  });

  it("disable-model-invocation marks a skill slash-only and hides it from format()", async () => {
    installSkill(
      "grill-me",
      "---\nname: grill-me\ndescription: Relentless interview.\ndisable-model-invocation: true\n---\nGrill.",
    );
    installSkill("normal");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.get("grill-me")?.userOnly).toBe(true);
    expect(svc.get("normal")?.userOnly).toBeUndefined();
    const xml = svc.format(undefined, true);
    expect(xml).toContain("<name>normal</name>");
    expect(xml).not.toContain("grill-me"); // model never sees slash-only skills
  });

  it("reload drops skills whose files vanished", async () => {
    installSkill("ghost");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    expect(svc.get("ghost")).toBeDefined();
    rmSync(join(skillsDir, "ghost"), { recursive: true });
    await svc.load();
    expect(svc.get("ghost")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// importFromPath / remove
// ---------------------------------------------------------------------------

describe("importFromPath", () => {
  it("copies a skill folder whole, supporting files included", async () => {
    const src = join(root, "incoming", "helper");
    mkdirSync(join(src, "assets"), { recursive: true });
    writeFileSync(join(src, "SKILL.md"), md("helper"));
    writeFileSync(join(src, "assets", "ref.txt"), "reference data");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.importFromPath(src)).resolves.toBe("helper");
    expect(svc.get("helper")).toBeDefined();
    expect(existsSync(join(skillsDir, "helper", "assets", "ref.txt"))).toBe(true);
  });

  it("wraps a bare .md file into <name>/SKILL.md", async () => {
    const file = join(root, "solo.md");
    writeFileSync(file, md("solo"));
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.importFromPath(file)).resolves.toBe("solo");
    expect(existsSync(join(skillsDir, "solo", "SKILL.md"))).toBe(true);
  });

  it("rejects a folder without SKILL.md, invalid frontmatter, and name collisions", async () => {
    const svc = new SkillsService(skillsDir);
    installSkill("taken");
    await svc.load();

    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    await expect(svc.importFromPath(empty)).rejects.toThrow(/SKILL\.md/);

    const invalid = join(root, "invalid.md");
    writeFileSync(invalid, "no frontmatter");
    await expect(svc.importFromPath(invalid)).rejects.toThrow(/frontmatter/i);

    const dupe = join(root, "taken.md");
    writeFileSync(dupe, md("taken"));
    await expect(svc.importFromPath(dupe)).rejects.toThrow(/already installed/);
    // The failed import must not have clobbered the existing skill.
    expect(svc.get("taken")).toBeDefined();
  });
});

describe("remove", () => {
  it("deletes the skill's directory and unlists it", async () => {
    installSkill("doomed");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.remove("doomed")).resolves.toBe(true);
    expect(existsSync(join(skillsDir, "doomed"))).toBe(false);
    expect(svc.get("doomed")).toBeUndefined();
  });

  it("removes a flat *.skill.md file without touching siblings", async () => {
    writeFileSync(join(skillsDir, "flat.skill.md"), md("flat"));
    installSkill("neighbor");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.remove("flat")).resolves.toBe(true);
    expect(existsSync(join(skillsDir, "flat.skill.md"))).toBe(false);
    expect(svc.get("neighbor")).toBeDefined();
  });

  it("returns false for an unknown skill", async () => {
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.remove("nope")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// importFromUrl — real local HTTP server, no mocks
// ---------------------------------------------------------------------------

describe("importFromUrl", () => {
  let server: Server;
  let base: string;
  /** path (leading slash, query included) → body or {status, body}; 404 otherwise */
  let routes: Record<string, string | { status: number; body?: string }>;

  beforeEach(async () => {
    routes = {};
    server = createServer((req, res) => {
      const route = routes[req.url ?? ""];
      if (route === undefined) {
        res.writeHead(404).end();
        return;
      }
      if (typeof route === "string") res.writeHead(200).end(route);
      else res.writeHead(route.status).end(route.body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("installs a raw SKILL.md URL", async () => {
    routes["/things/web-skill.md"] = md("web-skill");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    const result = await svc.importFromUrl(`${base}/things/web-skill.md`);
    expect(result).toEqual({ imported: ["web-skill"], skipped: [] });
    expect(existsSync(join(skillsDir, "web-skill", "SKILL.md"))).toBe(true);
  });

  it("installs a catalogue (index.json) with supporting files, reporting per-skill failures", async () => {
    routes["/cat/index.json"] = JSON.stringify({
      skills: [
        { name: "one", files: ["SKILL.md", "extra.txt"] },
        { name: "no-md", files: ["other.txt"] },
        { name: "../escape", files: ["SKILL.md"] },
      ],
    });
    routes["/cat/one/SKILL.md"] = md("one");
    routes["/cat/one/extra.txt"] = "支援 file";
    const svc = new SkillsService(skillsDir);
    await svc.load();
    const result = await svc.importFromUrl(`${base}/cat`);
    expect(result.imported).toEqual(["one"]);
    expect(result.skipped).toHaveLength(2);
    expect(existsSync(join(skillsDir, "one", "extra.txt"))).toBe(true);
    // The traversal name never produced a directory outside the skills dir.
    expect(existsSync(join(root, "escape"))).toBe(false);
  });

  it("cleans up and reports when a catalogue SKILL.md names itself differently", async () => {
    routes["/cat/index.json"] = JSON.stringify({ skills: [{ name: "claimed", files: ["SKILL.md"] }] });
    routes["/cat/claimed/SKILL.md"] = md("actually-other");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    const result = await svc.importFromUrl(`${base}/cat`);
    expect(result.imported).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("actually-other");
    expect(existsSync(join(skillsDir, "claimed"))).toBe(false);
  });

  it("skips a catalogue skill whose name is already installed", async () => {
    installSkill("mine");
    routes["/cat/index.json"] = JSON.stringify({ skills: [{ name: "mine", files: ["SKILL.md"] }] });
    routes["/cat/mine/SKILL.md"] = md("mine");
    const svc = new SkillsService(skillsDir);
    await svc.load();
    const result = await svc.importFromUrl(`${base}/cat`);
    expect(result.imported).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("already installed");
  });

  it("throws a user-facing error for a URL that is neither skill nor catalogue", async () => {
    routes["/page"] = "<html>hello</html>";
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.importFromUrl(`${base}/page`)).rejects.toThrow(/neither a GitHub repository/);
  });

  it("surfaces the parse error when an explicit .md URL isn't a valid skill", async () => {
    routes["/bad.md"] = "# not a skill";
    const svc = new SkillsService(skillsDir);
    await svc.load();
    await expect(svc.importFromUrl(`${base}/bad.md`)).rejects.toThrow(/frontmatter/i);
  });

  // ── GitHub repos — the ecosystem's distribution unit (skills.sh / npx skills add) ──

  const ghService = () =>
    new SkillsService(skillsDir, { githubApiBase: `${base}/api`, githubRawBase: `${base}/raw` });

  const seedGithubRepo = () => {
    routes["/api/repos/matt/skills"] = JSON.stringify({ default_branch: "main" });
    routes["/api/repos/matt/skills/git/trees/main?recursive=1"] = JSON.stringify({
      tree: [
        { path: "README.md", type: "blob", size: 10 },
        { path: "grill-me/SKILL.md", type: "blob", size: 80 },
        { path: "grill-me/refs/data.txt", type: "blob", size: 20 },
        { path: "other-skill/SKILL.md", type: "blob", size: 80 },
      ],
    });
    routes["/raw/matt/skills/main/grill-me/SKILL.md"] = md("grill-me", "Grills your code.");
    routes["/raw/matt/skills/main/grill-me/refs/data.txt"] = "grill data";
    routes["/raw/matt/skills/main/other-skill/SKILL.md"] = md("other-skill");
  };

  it("discovers every skill folder in a GitHub repo with real names/descriptions", async () => {
    seedGithubRepo();
    const svc = ghService();
    await svc.load();
    const { skills, skipped } = await svc.discoverFromUrl("https://github.com/matt/skills");
    expect(skipped).toEqual([]);
    expect(skills.map((s) => s.name)).toEqual(["grill-me", "other-skill"]);
    expect(skills[0]?.description).toBe("Grills your code.");
    // The skill's folder travels whole: SKILL.md + supporting files.
    expect(skills[0]?.files.map((f) => f.rel).sort()).toEqual(["SKILL.md", "refs/data.txt"]);
  });

  it("installs only the picked skill, supporting files included (--skill equivalent)", async () => {
    seedGithubRepo();
    const svc = ghService();
    await svc.load();
    const result = await svc.importFromUrl("https://github.com/matt/skills", ["grill-me"]);
    expect(result).toEqual({ imported: ["grill-me"], skipped: [] });
    expect(existsSync(join(skillsDir, "grill-me", "refs", "data.txt"))).toBe(true);
    expect(svc.get("grill-me")).toBeDefined();
    expect(svc.get("other-skill")).toBeUndefined();
  });

  it("reports a picked name that isn't in the repo", async () => {
    seedGithubRepo();
    const svc = ghService();
    await svc.load();
    const result = await svc.importFromUrl("https://github.com/matt/skills", ["nope"]);
    expect(result.imported).toEqual([]);
    expect(result.skipped[0]).toEqual({ source: "nope", reason: "Not found at that URL." });
  });

  it("scopes discovery to a /tree/<branch>/<subpath> URL", async () => {
    seedGithubRepo();
    const svc = ghService();
    await svc.load();
    const { skills } = await svc.discoverFromUrl("https://github.com/matt/skills/tree/main/grill-me");
    expect(skills.map((s) => s.name)).toEqual(["grill-me"]);
  });

  it("a repo-root SKILL.md claims the repo's files but not nested skills' folders", async () => {
    routes["/api/repos/solo/kit"] = JSON.stringify({ default_branch: "main" });
    routes["/api/repos/solo/kit/git/trees/main?recursive=1"] = JSON.stringify({
      tree: [
        { path: "SKILL.md", type: "blob", size: 80 },
        { path: "docs/help.txt", type: "blob", size: 10 },
        { path: "extras/nested/SKILL.md", type: "blob", size: 80 },
      ],
    });
    routes["/raw/solo/kit/main/SKILL.md"] = md("root-skill");
    routes["/raw/solo/kit/main/extras/nested/SKILL.md"] = md("nested-skill");
    const svc = ghService();
    await svc.load();
    const { skills } = await svc.discoverFromUrl("https://github.com/solo/kit");
    const root = skills.find((s) => s.name === "root-skill");
    expect(root?.files.map((f) => f.rel).sort()).toEqual(["SKILL.md", "docs/help.txt"]);
    expect(skills.map((s) => s.name).sort()).toEqual(["nested-skill", "root-skill"]);
  });

  it("explains GitHub rate limits and missing repos in human terms", async () => {
    routes["/api/repos/limited/repo"] = { status: 403 };
    const svc = ghService();
    await svc.load();
    await expect(svc.discoverFromUrl("https://github.com/limited/repo")).rejects.toThrow(/rate limit/);
    await expect(svc.discoverFromUrl("https://github.com/absent/repo")).rejects.toThrow(/not found/i);
  });
});
