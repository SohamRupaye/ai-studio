import { execSync } from "node:child_process";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

export const bashDef: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command. Dangerous commands will be blocked or require confirmation.",
  parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string", description: "Working directory (optional)" } }, required: ["command"] },
};

const BLOCKED_PATTERNS = [
  /\brm\s+(-[rf]+\s+)?\//, // rm -rf /
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /\bchmod\s+777/,
  /\bchown\s+-R\s+root/,
  /\bkill\s+-9\s+1\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\s+(stop|disable|mask)/,
  /\bcurl\b.*\|\s*(ba)?sh/,
  /\bwget\b.*\|\s*(ba)?sh/,
];

const WARN_PATTERNS = [
  /\brm\b/,
  /\bgit\s+push/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+branch\s+-D/,
  /\bdrop\s+(table|database)/i,
  /\btruncate\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bnpm\s+publish/,
  /\bkill\b/,
];

// Receives the raw command (not a formatted message) so the approval UI can
// summarize it the same way it summarizes any other tool call.
let _confirmCallback: ((command: string) => Promise<boolean>) | null = null;

export function setBashConfirmCallback(cb: (command: string) => Promise<boolean>) {
  _confirmCallback = cb;
}

export const bash: ToolHandler = async (args) => {
  const cmd = args["command"] as string;
  const cwd = (args["cwd"] as string) || process.cwd();

  // Hard block
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return `BLOCKED: Command matches dangerous pattern (${pattern.source}). Refusing to execute.`;
  }

  // Soft warn — ask for confirmation
  for (const pattern of WARN_PATTERNS) {
    if (pattern.test(cmd)) {
      if (_confirmCallback) {
        const ok = await _confirmCallback(cmd);
        if (!ok) return "Command cancelled by user.";
      }
      break;
    }
  }

  try {
    const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    return output.slice(0, 10_000) || "(no output)";
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const stdout = e.stdout?.toString() || "";
    return `Exit code: ${e.status}\n${stdout}\n${stderr}`.slice(0, 10_000);
  }
};
