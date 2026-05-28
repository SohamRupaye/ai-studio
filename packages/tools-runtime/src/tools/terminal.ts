/**
 * terminal.ts — Long-running terminal session management.
 * Spawns persistent subprocess sessions (dev servers, REPLs, watch modes),
 * reads buffered output, sends input, kills sessions.
 * 
 * Sessions are keyed by name and persist across tool calls within the same process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Session store ─────────────────────────────────────────────────────────────

interface Session {
  name: string;
  cmd: string;
  cwd: string;
  proc: ChildProcess;
  outputBuffer: string[];
  maxBufferLines: number;
  startedAt: Date;
  alive: boolean;
  timeout: NodeJS.Timeout;
}

const sessions = new Map<string, Session>();

// Auto-cleanup all sessions on process exit
function cleanupAllSessions() {
  for (const [name, session] of sessions) {
    try { session.proc.kill("SIGTERM"); } catch {}
  }
  sessions.clear();
}
process.on("exit", cleanupAllSessions);
process.on("SIGINT", () => { cleanupAllSessions(); process.exit(0); });
process.on("SIGTERM", () => { cleanupAllSessions(); process.exit(0); });

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function createSession(name: string, cmd: string, cwd: string): Session {
  const [bin, ...cmdArgs] = cmd.split(/\s+/);
  const proc = spawn(bin!, cmdArgs, {
    cwd,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session: Session = {
    name,
    cmd,
    cwd,
    proc,
    outputBuffer: [],
    maxBufferLines: 500,
    startedAt: new Date(),
    alive: true,
    timeout: setTimeout(() => {
      session.outputBuffer.push(`[timeout] Session auto-killed after 30 minutes`);
      try { proc.kill("SIGTERM"); } catch {}
      sessions.delete(name);
    }, SESSION_TIMEOUT_MS),
  };

  const addLine = (prefix: string, data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      session.outputBuffer.push(`[${prefix}] ${line}`);
      if (session.outputBuffer.length > session.maxBufferLines) {
        session.outputBuffer.shift();
      }
    }
  };

  proc.stdout?.on("data", (data: Buffer) => addLine("out", data));
  proc.stderr?.on("data", (data: Buffer) => addLine("err", data));
  proc.on("exit", (code) => {
    session.alive = false;
    session.outputBuffer.push(`[exit] Process exited with code ${code}`);
  });
  proc.on("error", (err) => {
    session.alive = false;
    session.outputBuffer.push(`[error] ${err.message}`);
  });

  return session;
}

// ── Tool: terminal_start ──────────────────────────────────────────────────────

export const terminalStartDef: ToolDefinition = {
  name: "terminal_start",
  description: "Start a long-running terminal session (dev server, build watcher, REPL, etc.). The process runs in the background. Use terminal_read to see output, terminal_send to send input.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Session name (e.g. 'dev-server', 'test-watch')" },
      command: { type: "string", description: "Command to run (e.g. 'npm run dev')" },
      cwd: { type: "string", description: "Working directory (default: cwd)" },
      restart_if_exists: { type: "boolean", description: "If true, kill any existing session with this name first" },
    },
    required: ["name", "command"],
  },
};

export const terminalStart: ToolHandler = async (args) => {
  const name = args["name"] as string;
  const command = args["command"] as string;
  const cwd = (args["cwd"] as string) || process.cwd();
  const restart = args["restart_if_exists"] as boolean | undefined;

  if (sessions.has(name)) {
    if (!restart) return `Session '${name}' already exists. Use terminal_read/terminal_send, or pass restart_if_exists=true.`;
    const existing = sessions.get(name)!;
    clearTimeout(existing.timeout);
    try { existing.proc.kill("SIGTERM"); } catch {}
    sessions.delete(name);
  }

  const session = createSession(name, command, cwd);
  sessions.set(name, session);

  // Brief delay to capture immediate output / startup errors
  await new Promise(r => setTimeout(r, 500));

  const initialOutput = session.outputBuffer.slice(-20).join("\n");
  const status = session.alive ? "🟢 running" : "🔴 exited";
  return `Session '${name}' started (${status})\nCommand: ${command}\nCwd: ${cwd}\n\nInitial output:\n${initialOutput || "(no output yet)"}`;
};

// ── Tool: terminal_read ───────────────────────────────────────────────────────

export const terminalReadDef: ToolDefinition = {
  name: "terminal_read",
  description: "Read buffered output from a running terminal session. Optionally wait for a specific string to appear (useful for waiting for server ready signals).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Session name" },
      lines: { type: "number", description: "Number of recent lines to return (default: 50)" },
      wait_for: { type: "string", description: "Wait up to 10s for this string to appear in output" },
      clear: { type: "boolean", description: "Clear the output buffer after reading" },
    },
    required: ["name"],
  },
};

export const terminalRead: ToolHandler = async (args) => {
  const name = args["name"] as string;
  const lines = (args["lines"] as number) || 50;
  const waitFor = args["wait_for"] as string | undefined;
  const clear = args["clear"] as boolean | undefined;

  const session = sessions.get(name);
  if (!session) return `No session named '${name}'. Available: ${[...sessions.keys()].join(", ") || "none"}`;

  if (waitFor) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = session.outputBuffer.some(l => l.includes(waitFor));
      if (found) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const output = session.outputBuffer.slice(-lines).join("\n");
  if (clear) session.outputBuffer = [];

  const status = session.alive ? "🟢 running" : `🔴 exited`;
  return `Session '${name}' [${status}] — last ${Math.min(lines, session.outputBuffer.length)} lines:\n\n${output || "(empty)"}`;
};

// ── Tool: terminal_send ───────────────────────────────────────────────────────

export const terminalSendDef: ToolDefinition = {
  name: "terminal_send",
  description: "Send input (stdin) to a running terminal session. Useful for REPLs, interactive scripts, or triggering hotkeys.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Session name" },
      input: { type: "string", description: "Text to send to the process (newline appended automatically)" },
    },
    required: ["name", "input"],
  },
};

export const terminalSend: ToolHandler = async (args) => {
  const name = args["name"] as string;
  const input = args["input"] as string;

  const session = sessions.get(name);
  if (!session) return `No session named '${name}'.`;
  if (!session.alive) return `Session '${name}' is no longer running.`;

  session.proc.stdin?.write(input + "\n");

  // Brief wait then return recent output
  await new Promise(r => setTimeout(r, 300));
  const output = session.outputBuffer.slice(-20).join("\n");
  return `Sent to '${name}': ${input}\n\nRecent output:\n${output}`;
};

// ── Tool: terminal_kill ───────────────────────────────────────────────────────

export const terminalKillDef: ToolDefinition = {
  name: "terminal_kill",
  description: "Kill a running terminal session.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Session name to kill" },
    },
    required: ["name"],
  },
};

export const terminalKill: ToolHandler = async (args) => {
  const name = args["name"] as string;
  const session = sessions.get(name);
  if (!session) return `No session named '${name}'.`;

  clearTimeout(session.timeout);
  try {
    session.proc.kill("SIGTERM");
    await new Promise(r => setTimeout(r, 500));
    if (session.alive) session.proc.kill("SIGKILL");
  } catch {}

  sessions.delete(name);
  return `Session '${name}' killed.`;
};

// ── Tool: terminal_list ───────────────────────────────────────────────────────

export const terminalListDef: ToolDefinition = {
  name: "terminal_list",
  description: "List all active terminal sessions.",
  parameters: { type: "object", properties: {}, required: [] },
};

export const terminalList: ToolHandler = async () => {
  if (!sessions.size) return "No active terminal sessions.";
  const lines = ["Active sessions:\n"];
  for (const [name, s] of sessions) {
    const status = s.alive ? "🟢 running" : "🔴 dead";
    const uptime = Math.round((Date.now() - s.startedAt.getTime()) / 1000);
    lines.push(`  ${name.padEnd(20)} ${status}  cmd: ${s.cmd}  uptime: ${uptime}s  buf: ${s.outputBuffer.length} lines`);
  }
  return lines.join("\n");
};
