import { app, BrowserWindow, shell } from "electron";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { Store, GlobalMemory } from "@squirl/database";
import { Router, getConfig, loadConfig } from "@squirl/providers";
import {
  CostTracker, createRuntime, loadPending, resumeQueue, loadNodeCounter,
  PermissionStore, PersonaRegistry, SnapshotManager,
} from "@squirl/ai-core";
import {
  createDefaultRegistry, loadMCPServers, getLSPClient, SkillsService, getMCPManager,
} from "@squirl/tools-runtime";
import { MetaGraph } from "@squirl/graph-engine";
import {
  mainWindow, store, router, graph, registry, globalMem, snapshots, skills, nodeCounter,
  currentProjectId, memoryScope, refreshModelsInBackground,
  setMainWindow, setStore, setRouter, setGraph, setGlobalMem, setRegistry, setCostTracker,
  setPermissions, setPersonas, setSnapshots, setSkills, setDataDirPath,
  setActiveBranchId, setCurrentUserId,
} from "./state.js";
import { sweepOrphanBlobs } from "./images.js";
import { registerChatHandlers } from "./ipc/chat.js";
import { registerArtifactHandlers } from "./ipc/artifacts.js";
import { registerWorkspaceHandlers } from "./ipc/workspace.js";
import { registerBranchHandlers } from "./ipc/branches.js";
import { registerMemoryHandlers } from "./ipc/memory.js";
import { registerWindowHandlers } from "./ipc/window.js";
import { registerSystemHandlers } from "./ipc/system.js";
import { registerToolingHandlers } from "./ipc/tools.js";
import { registerNotifyHandlers } from "./ipc/notify.js";

if (require("electron-squirrel-startup")) app.quit();

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      // Enables Chromium's built-in PDF viewer so the artifacts page can render
      // a preserved PDF original in an <iframe> (blob: URL).
      plugins: true,
    },
  });
  setMainWindow(win);
  win.setWindowButtonVisibility(true);
  win.on("enter-full-screen", () => { mainWindow?.webContents.send("window:fullscreen-changed", true); });
  win.on("leave-full-screen", () => { mainWindow?.webContents.send("window:fullscreen-changed", false); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  win.on("closed", () => { setMainWindow(null); });
}

// ── Runtime init ──────────────────────────────────────────────────────────────

async function initRuntime() {
  const dataDir = join(app.getPath("userData"), "data");
  setDataDirPath(dataDir);
  // Config must live alongside the rest of the app's persisted data, not in
  // process.cwd() (which is unpredictable for a packaged/dev Electron app and
  // caused saved provider keys to silently vanish on restart).
  const cfg = loadConfig(join(app.getPath("userData"), "config.yaml"));

  setStore(new Store(join(dataDir, "workspace.db")));
  // Original bytes of uploaded files live here; the DB row holds a relative
  // path into it. Kept out of SQLite so a 20MB PDF doesn't bloat the .db.
  mkdirSync(join(dataDir, "blobs"), { recursive: true });
  sweepOrphanBlobs();
  setRouter(Router.fromEnv());
  refreshModelsInBackground(router);
  setGraph(new MetaGraph(join(dataDir, "graphs")));
  setGlobalMem(new GlobalMemory(dataDir));
  setCostTracker(new CostTracker());
  setPermissions(new PermissionStore(dataDir));
  setPersonas(new PersonaRegistry([dataDir]));
  setSnapshots(new SnapshotManager());

  setRegistry(createDefaultRegistry());

  // Snapshot tracking: capture pre-write file state for write_file/edit_file/patch
  // so a branch's file changes can be listed and reverted from the UI. Keyed by
  // ctx.sessionId, which chat:send sets to the active branchId.
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "patch"]);
  registry.onBeforeExecute(async (toolId, args, ctx) => {
    if (!WRITE_TOOLS.has(toolId) || !ctx.sessionId) return args;
    snapshots.startTracking(ctx.sessionId);
    const filePath = (args as any)?.path ?? (args as any)?.file_path;
    if (typeof filePath === "string") snapshots.recordBefore(ctx.sessionId, filePath);
    return args;
  });
  registry.onAfterExecute(async (toolId, result, ctx) => {
    if (WRITE_TOOLS.has(toolId) && ctx.sessionId && !(result as any)?.metadata?.error) {
      snapshots.commit(ctx.sessionId, `${toolId} via chat`);
    }
    return result;
  });

  // App-level memory tools wired to the SAME GlobalMemory the UI reads from.
  // (The built-in kb_* tools write to a separate JSON store, so the agent's
  // "remember" requests never showed up in the app. These fix that.)
  registry.register(
    {
      name: "remember",
      description:
        "Persist a durable fact about the user to long-term memory so it is available in every future conversation. Call this when the user explicitly asks you to remember, save, note, or store something, or states a clearly durable fact about themselves (stable preferences, standing constraints, personal details). Do NOT store transient details of the current task — those live in the conversation. Phrase the fact as a standalone statement.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The fact to remember, as a standalone statement." },
        },
        required: ["text"],
      },
    },
    async (args: Record<string, unknown>) => {
      const text = String(args["text"] ?? "").trim();
      if (!text) return "No fact provided to remember.";
      const fact = globalMem.add(text, memoryScope());
      const where = currentProjectId ? "this project's memory" : "long-term memory";
      return `✅ Saved to ${where} (id=${fact.id}): "${fact.text}"`;
    },
  );

  registry.register(
    {
      name: "recall_memories",
      description:
        "List all durable facts stored about the user in long-term memory. Use this when the user asks what you remember or know about them.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    async () => {
      const scope = memoryScope();
      const facts = globalMem.list().filter((f) => f.scope === "global" || f.scope === scope);
      if (!facts.length) return "No long-term memories stored yet.";
      return "Long-term memories:\n" + facts.map((f) => `• ${f.text}`).join("\n");
    },
  );

  createRuntime(router, registry, cfg.defaultModel);

  // Load node counter from persisted max ID (not graph.size)
  nodeCounter.current = loadNodeCounter(dataDir);
  if (nodeCounter.current < graph.size) nodeCounter.current = graph.size;

  // Load classifier queue
  loadPending(dataDir);
  resumeQueue(router, graph, nodeCounter);

  // Load MCP servers
  if (cfg.mcpServers.length) {
    loadMCPServers(cfg.mcpServers, registry).catch(e => console.error("[mcp]", e.message));
  }
  // Any status change (connected, needs_auth, failed, reconnecting) pushes to
  // the renderer so the settings page reflects live state without polling.
  getMCPManager().on("status", () => {
    mainWindow?.webContents.send("mcp:changed", undefined);
  });

  // Skills: managed SKILL.md packages in <dataDir>/skills. The system prompt
  // advertises enabled skills (name + description only); the `skill` tool
  // loads a body on demand — progressive disclosure, bodies are never all
  // preloaded. External edits to the dir hot-reload and notify the renderer.
  setSkills(new SkillsService(join(dataDir, "skills")));
  await skills.load();
  skills.startWatching(() => mainWindow?.webContents.send("skills:changed", undefined))
    .catch((e) => console.error("[skills]", e?.message ?? e));
  registry.register(
    {
      name: "skill",
      description:
        "Load a skill — a reusable package of instructions for a specialized task. The <available_skills> block in the system prompt lists the installed skills and what each is for. When a task matches a skill's description, call this with the exact skill name BEFORE attempting the task, then follow the returned instructions for the rest of the turn.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact skill name as listed in <available_skills>." },
        },
        required: ["name"],
      },
    },
    async (args: Record<string, unknown>) => {
      const name = String(args["name"] ?? "").trim();
      const found = skills.get(name);
      // userOnly skills (disable-model-invocation) exist only behind the
      // user's slash command — to the model they don't exist at all.
      if (!found || found.userOnly || getConfig().disabledSkills.includes(name)) {
        const available = skills
          .all({ deny: getConfig().disabledSkills })
          .filter((s) => !s.userOnly)
          .map((s) => s.name)
          .join(", ") || "none";
        return `Unknown skill "${name}". Available skills: ${available}.`;
      }
      return `# Skill: ${found.name}\n\n${found.content}\n\n(Supporting files for this skill live in ${dirname(found.location)} — resolve relative paths in the instructions against that directory.)`;
    },
  );

  // Init LSP
  getLSPClient(app.getPath("userData"));

  // Seed defaults
  store.ensureDefaults(cfg.defaultModel);
  setActiveBranchId(store.getActiveBranchId() || store.listBranches()[0]?.id || "");

  // Load user
  setCurrentUserId(store.getMeta("current_user_id") || "");
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function registerHandlers() {
  registerChatHandlers();
  registerArtifactHandlers();
  registerWorkspaceHandlers();
  registerWindowHandlers();
  registerBranchHandlers();
  registerMemoryHandlers();
  registerSystemHandlers();
  registerToolingHandlers();
  registerNotifyHandlers();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initRuntime();
  registerHandlers();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
