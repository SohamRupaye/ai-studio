import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  tools: string[];
  instructions: string;
}

/** Parse a skill markdown file into a Skill object. */
function parseMd(text: string): Skill {
  let name = "";
  const sections: Record<string, string> = {};
  let currentSection = "description";
  let currentLines: string[] = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("# ") && !line.startsWith("## ")) { name = line.slice(2).trim(); continue; }
    if (line.startsWith("## ")) {
      sections[currentSection] = currentLines.join("\n").trim();
      currentSection = line.slice(3).trim().toLowerCase();
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  sections[currentSection] = currentLines.join("\n").trim();

  const tools = (sections["tools"] || "").split(/[,\n]/).map(t => t.trim()).filter(Boolean);
  return { name: name || "unnamed", description: sections["description"] || "", tools, instructions: sections["instructions"] || "" };
}

export function loadSkill(name: string, skillsDir: string): Skill | undefined {
  const path = join(skillsDir, `${name}.md`);
  if (!existsSync(path)) return undefined;
  return parseMd(readFileSync(path, "utf-8"));
}

export function listSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter(f => f.endsWith(".md"))
    .map(f => parseMd(readFileSync(join(skillsDir, f), "utf-8")));
}

export function buildSkillPrompt(skill: Skill, userMessage: string): string {
  return `${skill.instructions}\n\nUser request: ${userMessage}`;
}
