import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkill, listSkills, buildSkillPrompt } from "../../skills/runner.js";
import type { Skill } from "../../skills/runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TMP = tmpdir();
let testDir: string;
let dirCounter = 0;

beforeEach(() => {
  // Use a unique dir per test to avoid cross-test interference
  testDir = join(BASE_TMP, `skills-test-${process.pid}-${Date.now()}-${++dirCounter}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function writeSkill(name: string, content: string): void {
  writeFileSync(join(testDir, `${name}.md`), content, "utf-8");
}

const SAMPLE_SKILL_MD = `# My Skill
## description
Does something useful.
## tools
read_file, write_file
## instructions
Step 1: read the file.
Step 2: write it back.
`;

// ---------------------------------------------------------------------------
// loadSkill
// ---------------------------------------------------------------------------

describe("loadSkill", () => {
  it("returns undefined for a nonexistent skill", () => {
    const result = loadSkill("nonexistent", testDir);
    expect(result).toBeUndefined();
  });

  it("returns undefined when skillsDir does not exist", () => {
    const result = loadSkill("any", join(BASE_TMP, "no-such-dir-ever"));
    expect(result).toBeUndefined();
  });

  it("loads and parses a valid skill file correctly", () => {
    writeSkill("my-skill", SAMPLE_SKILL_MD);
    const skill = loadSkill("my-skill", testDir);

    expect(skill).toBeDefined();
    expect(skill!.name).toBe("My Skill");
    expect(skill!.description).toBe("Does something useful.");
    expect(skill!.tools).toEqual(["read_file", "write_file"]);
    expect(skill!.instructions).toContain("Step 1");
    expect(skill!.instructions).toContain("Step 2");
  });

  it("parses comma-separated tools correctly (each is trimmed)", () => {
    writeSkill("trimtest", `# Trim Test\n## tools\n  alpha ,  beta,gamma  \n## instructions\nDo it.\n`);
    const skill = loadSkill("trimtest", testDir);
    expect(skill).toBeDefined();
    expect(skill!.tools).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty tools array when no tools section is present", () => {
    writeSkill("no-tools", `# No Tools Skill\n## description\nA skill without tools.\n## instructions\nJust do it.\n`);
    const skill = loadSkill("no-tools", testDir);
    expect(skill).toBeDefined();
    expect(skill!.tools).toEqual([]);
  });

  it("handles newline-separated tools in the tools section", () => {
    writeSkill("newline-tools", `# NL Tools\n## tools\ntool_a\ntool_b\ntool_c\n## instructions\nRun them.\n`);
    const skill = loadSkill("newline-tools", testDir);
    expect(skill).toBeDefined();
    expect(skill!.tools).toContain("tool_a");
    expect(skill!.tools).toContain("tool_b");
    expect(skill!.tools).toContain("tool_c");
  });

  it("falls back to 'unnamed' when no # heading is present", () => {
    writeSkill("noname", `## description\nNo title.\n## instructions\nDo stuff.\n`);
    const skill = loadSkill("noname", testDir);
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("unnamed");
  });
});

// ---------------------------------------------------------------------------
// listSkills
// ---------------------------------------------------------------------------

describe("listSkills", () => {
  it("returns [] when skillsDir does not exist", () => {
    const result = listSkills(join(BASE_TMP, "ghost-dir-xyz"));
    expect(result).toEqual([]);
  });

  it("returns [] for an empty directory", () => {
    const result = listSkills(testDir);
    expect(result).toEqual([]);
  });

  it("returns all skills when 2 skill files are present", () => {
    writeSkill("skill-a", `# Skill A\n## description\nFirst.\n## instructions\nDo A.\n`);
    writeSkill("skill-b", `# Skill B\n## description\nSecond.\n## instructions\nDo B.\n`);
    const result = listSkills(testDir);
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("Skill A");
    expect(names).toContain("Skill B");
  });

  it("ignores non-.md files", () => {
    writeSkill("valid", `# Valid\n## description\nGood.\n## instructions\nDo it.\n`);
    writeFileSync(join(testDir, "ignore.txt"), "not a skill");
    writeFileSync(join(testDir, "ignore.json"), "{}");
    const result = listSkills(testDir);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildSkillPrompt
// ---------------------------------------------------------------------------

describe("buildSkillPrompt", () => {
  it("returns a string containing the skill instructions", () => {
    const skill: Skill = {
      name: "Test Skill",
      description: "Does things.",
      tools: [],
      instructions: "Step 1: do something.\nStep 2: finish.",
    };
    const prompt = buildSkillPrompt(skill, "do it");
    expect(prompt).toContain("Step 1: do something.");
    expect(prompt).toContain("Step 2: finish.");
  });

  it("returns a string containing the user message", () => {
    const skill: Skill = {
      name: "Test Skill",
      description: "Does things.",
      tools: [],
      instructions: "Follow the steps.",
    };
    const prompt = buildSkillPrompt(skill, "do it now please");
    expect(prompt).toContain("do it now please");
  });

  it("built from a loaded skill contains both instructions and user message", () => {
    writeSkill("my-skill", SAMPLE_SKILL_MD);
    const skill = loadSkill("my-skill", testDir)!;
    const prompt = buildSkillPrompt(skill, "run it");
    expect(prompt).toContain("Step 1");
    expect(prompt).toContain("run it");
  });
});
