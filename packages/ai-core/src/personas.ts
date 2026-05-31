/**
 * Agent Personas - Configurable agent modes with distinct system prompts,
 * tool access, skill access, and model preferences
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

export interface AgentPersona {
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  allowedSkills?: string[];
  deniedSkills?: string[];
  /** Max iterations for this agent */
  maxIterations?: number;
  /** Temperature override */
  temperature?: number;
}

const BUILT_IN_PERSONAS: AgentPersona[] = [
  {
    name: "default",
    description: "General-purpose AI assistant",
    systemPrompt: "You are an intelligent AI assistant. You help the user by taking action, writing code, answering questions, and completing tasks thoroughly.",
  },
  {
    name: "coder",
    description: "Focused software engineer",
    systemPrompt: "You are a senior software engineer. Write clean, production-quality code. Always read existing code before making changes. Run tests after modifications. Fix errors before presenting results.",
    allowedTools: ["read_file", "write_file", "edit_file", "bash", "grep_search", "glob_files", "find_definition", "find_references", "lsp_diagnostics", "run_tests", "git_status", "git_diff", "git_commit"],
  },
  {
    name: "researcher",
    description: "Deep research and analysis agent",
    systemPrompt: "You are a research analyst. Gather information thoroughly, cross-reference sources, and produce structured findings with citations. Think step-by-step before concluding.",
    allowedTools: ["web_search", "web_fetch", "read_file", "write_file", "knowledge_base", "think"],
    maxIterations: 20,
  },
  {
    name: "architect",
    description: "System design and planning",
    systemPrompt: "You are a software architect. Focus on system design, data modeling, API design, and technical decision-making. Ask clarifying questions. Document trade-offs.",
    allowedTools: ["read_file", "write_file", "grep_search", "glob_files", "find_definition", "project_symbols", "think", "web_search"],
  },
];

const CONFIG_FILE = "personas.json";

export class PersonaRegistry {
  private personas = new Map<string, AgentPersona>();
  private configDirs: string[];

  constructor(configDirs?: string[]) {
    this.configDirs = configDirs ?? [
      path.join(homedir(), ".ai-studio"),
      path.join(process.cwd(), ".ai-studio"),
    ];
    for (const p of BUILT_IN_PERSONAS) this.personas.set(p.name, p);
    this.loadFromDisk();
  }

  get(name: string): AgentPersona | undefined {
    return this.personas.get(name);
  }

  list(): AgentPersona[] {
    return Array.from(this.personas.values());
  }

  register(persona: AgentPersona): void {
    this.personas.set(persona.name, persona);
  }

  /** Check if a tool is allowed for a persona */
  isToolAllowed(persona: AgentPersona, toolName: string): boolean {
    if (persona.deniedTools?.includes(toolName)) return false;
    if (persona.allowedTools && !persona.allowedTools.includes(toolName)) return false;
    return true;
  }

  private loadFromDisk(): void {
    for (const dir of this.configDirs) {
      const file = path.join(dir, CONFIG_FILE);
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        const list: AgentPersona[] = Array.isArray(data) ? data : data.personas ?? [];
        for (const p of list) {
          if (p.name && p.systemPrompt) this.personas.set(p.name, p);
        }
      } catch {}
    }
  }
}
