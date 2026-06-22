import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import liquidGlass from "electron-liquid-glass";
import { Store, GlobalMemory } from "@ai-studio/database";
import { Router, getConfig, loadConfig } from "@ai-studio/providers";
import { Agent, CostTracker, createRuntime, classifyAndIndex, loadPending, resumeQueue, loadNodeCounter, extractAndPersistArtifacts, runAgentCooperative } from "@ai-studio/ai-core";
import { createDefaultRegistry, loadMCPServers, getLSPClient, listSkills } from "@ai-studio/tools-runtime";
import { MetaGraph } from "@ai-studio/graph-engine";
import { buildPayload, compareBranches } from "@ai-studio/prompt-engine";
import { runPendingSummaries, shouldSummarize } from "@ai-studio/prompt-engine";
import type { ToolRegistry } from "@ai-studio/tools-runtime";
import type { IpcInvokeChannel, IpcInvokeRequest, IpcInvokeResponse } from "@ai-studio/event-bus";

if (require("electron-squirrel-startup")) app.quit();

// ── Globals ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let store: Store;
let router: Router;
let graph: MetaGraph;
let globalMem: GlobalMemory;
let registry: ToolRegistry;
let costTracker: CostTracker;
let abortController: AbortController | null = null;
let nodeCounter = { current: 0 };
let activeBranchId = "";
let currentUserId = "";
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    titleBarStyle: "hiddenInset",
    transparent: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.setWindowButtonVisibility(true);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow) {
      liquidGlass.addView(mainWindow.getNativeWindowHandle(), {
        cornerRadius: 12,
        tintColor: "#00000008",
      });
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Runtime init ──────────────────────────────────────────────────────────────

async function initRuntime() {
  const dataDir = join(app.getPath("userData"), "data");
  const cfg = getConfig();

  store = new Store(join(dataDir, "workspace.db"));
  router = Router.fromEnv();
  graph = new MetaGraph(join(dataDir, "graphs"));
  globalMem = new GlobalMemory(dataDir);
  costTracker = new CostTracker();

  registry = createDefaultRegistry();
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

  // Load skills from data dir
  const skillsDir = join(dataDir, "skills");
  if (existsSync(skillsDir)) {
    const skills = listSkills(skillsDir);
    console.log(`[skills] Loaded ${skills.length} skills`);
  }

  // Init LSP
  getLSPClient(app.getPath("userData"));

  // Seed defaults
  store.ensureDefaults(cfg.defaultModel);
  activeBranchId = store.getActiveBranchId() || store.listBranches()[0]?.id || "";

  // Load user
  currentUserId = store.getMeta("current_user_id") || "";
}

// ── Summarization ─────────────────────────────────────────────────────────────

function scheduleSummarization(branchId: string) {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(async () => {
    summaryTimer = null;
    if (shouldSummarize(store, branchId)) {
      await runPendingSummaries(store, router, branchId);
    }
  }, 5000);
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function handle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (payload: IpcInvokeRequest<C>) => Promise<IpcInvokeResponse<C>> | IpcInvokeResponse<C>,
) {
  ipcMain.handle(channel, async (_event, payload: IpcInvokeRequest<C>) => handler(payload));
}

function registerHandlers() {
  // ── Chat ────────────────────────────────────────────────────────────────────

  handle("chat:send", async ({ branchId, message }) => {
    if (!mainWindow) return;
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    store.addMessage(branchId, "user", message);
    const branch = store.getBranch(branchId);
    if (!branch) {
      mainWindow.webContents.send("chat:stream", { type: "error", message: `Branch ${branchId} not found` });
      return;
    }

    const payload = await buildPayload(store, branch, graph, globalMem, message);
    const cfg = getConfig();
    const model = branch.model || cfg.defaultModel;
    createRuntime(router, registry, model);

    const system = `You are a helpful AI assistant in AI Studio, a desktop AI workspace. Use your tools to help the user accomplish tasks.\n\n${payload.systemContext}`;
    const agent = new Agent(router, registry);

    try {
      for await (const event of runAgentCooperative(agent, model, payload.messages, system, signal)) {
        if (signal.aborted) break;
        if (event.type === "text" || event.type === "tool_start" || event.type === "tool_end" || event.type === "tool_call_streaming") {
          mainWindow?.webContents.send("chat:stream", event);
        } else if (event.type === "done") {
          const assistantText = event.result.text;
          store.addMessage(branchId, "assistant", assistantText, model);

          // Cost tracking
          costTracker.record(model, { input_tokens: payload.tokenEstimate, output_tokens: assistantText.length / 4 });
          const lastEntry = costTracker.lastCost();
          const [inRate, outRate] = getCostRate(model);
          const estOut = Math.ceil(assistantText.length / 4);
          const costUsd = (payload.tokenEstimate * inRate + estOut * outRate) / 1_000_000;
          store.recordCost(branchId, model, payload.tokenEstimate, estOut, costUsd);

          mainWindow?.webContents.send("chat:stream", {
            type: "done", text: assistantText, iterations: event.result.iterations, cost: lastEntry,
          });

          // Classify + index
          const turnNum = store.getMessageCount(branchId) - 1;
          classifyAndIndex(router, graph, nodeCounter, message, assistantText, branchId, turnNum);

          // Auto-extract artifacts
          if (branch.chatId) {
            const chat = store.getChat(branch.chatId);
            if (chat) {
              extractAndPersistArtifacts(store, assistantText, branchId, chat.projectId);
            }
          }

          scheduleSummarization(branchId);
        }
      }
    } catch (err: any) {
      if (!signal.aborted) {
        mainWindow?.webContents.send("chat:stream", { type: "error", message: err.message });
      }
    }
  });

  handle("chat:abort", () => { abortController?.abort(); abortController = null; });

  // ── Organisations ───────────────────────────────────────────────────────────

  handle("org:list", () => store.listOrganisations());
  handle("org:create", ({ name }) => store.createOrganisation(name));

  // ── Projects ────────────────────────────────────────────────────────────────

  handle("project:list", ({ orgId }) => store.listProjects(orgId));
  handle("project:create", ({ orgId, name }) => store.createProject(orgId, name));

  // ── Chats ───────────────────────────────────────────────────────────────────

  handle("chat:list", ({ projectId }) => store.listChats(projectId));
  handle("chat:create", ({ projectId, name }) => store.createChat(projectId, name));

  // ── Branches ────────────────────────────────────────────────────────────────

  handle("branch:list", () => store.listBranches());
  handle("branch:create", ({ name, model, parentId, forkAtIndex, chatId }) => store.createBranch(name, model, parentId, forkAtIndex, chatId));
  handle("branch:delete", ({ id }) => store.deleteBranch(id));
  handle("branch:rename", ({ id, name }) => { store.updateBranchName(id, name); });
  handle("branch:switch", async ({ id }) => {
    if (activeBranchId && activeBranchId !== id && shouldSummarize(store, activeBranchId)) {
      runPendingSummaries(store, router, activeBranchId).catch(() => {});
    }
    activeBranchId = id;
    store.setActiveBranchId(id);
  });
  handle("branch:pin-add", ({ branchId, text }) => { store.addPin(branchId, text); });
  handle("branch:pin-remove", ({ branchId, index }) => store.removePin(branchId, index));
  handle("branch:compare", ({ branchIdA, branchIdB }) => compareBranches(store, graph, branchIdA, branchIdB));

  // ── Messages ────────────────────────────────────────────────────────────────

  handle("message:list", ({ branchId }) => store.getMessages(branchId).map(m => ({ role: m.role, content: m.content, turn: m.turn })));
  handle("message:undo", ({ branchId }) => store.undoLastTurn(branchId));

  // ── Artifacts ───────────────────────────────────────────────────────────────

  handle("artifact:list", ({ projectId }) => store.listArtifacts(projectId));
  handle("artifact:get", ({ id }) => store.getArtifact(id) ?? null);
  handle("artifact:update", ({ id, content, title }) => { store.updateArtifact(id, content, title); });

  // ── Memory ──────────────────────────────────────────────────────────────────

  handle("memory:list", ({ scope }) => globalMem.list(scope as any));
  handle("memory:add", ({ text, scope }) => globalMem.add(text, scope as any));
  handle("memory:remove", ({ id }) => globalMem.remove(id));

  // ── User ────────────────────────────────────────────────────────────────────

  handle("user:get", () => {
    if (!currentUserId) return null;
    const name = store.getMeta("user_name") || "User";
    return { id: currentUserId, name };
  });

  handle("user:set", ({ name, email }) => {
    if (!currentUserId) {
      const { randomUUID } = require("node:crypto");
      currentUserId = randomUUID();
      store.setMeta("current_user_id", currentUserId);
    }
    store.setMeta("user_name", name);
    if (email) store.setMeta("user_email", email);
    return { id: currentUserId, name };
  });

  // ── Models ──────────────────────────────────────────────────────────────────

  handle("models:list", () => router.listModels());

  // ── Config ──────────────────────────────────────────────────────────────────

  handle("config:get", () => {
    const cfg = getConfig();
    return { defaultModel: cfg.defaultModel, classifierEnabled: cfg.classifier.enabled, mcpServers: cfg.mcpServers };
  });

  handle("config:set", (payload) => {
    // Reload config from disk (runtime reload)
    loadConfig();
    const cfg = getConfig();
    router = Router.fromEnv();
    createRuntime(router, registry, cfg.defaultModel);
  });

  // ── Costs ───────────────────────────────────────────────────────────────────

  handle("costs:branch", ({ branchId }) => store.getCosts(branchId));
  handle("costs:project", ({ projectId }) => store.getProjectCosts(projectId));
}

// ── Cost helper ───────────────────────────────────────────────────────────────

function getCostRate(model: string): [number, number] {
  const PRICING: Record<string, [number, number]> = {
    "claude-sonnet": [3, 15], "claude-haiku": [0.25, 1.25], "claude-opus": [15, 75],
    "gpt-4o": [2.5, 10], "gpt-4o-mini": [0.15, 0.6], "gpt-5": [5, 15],
    "o1": [15, 60], "o3": [10, 40], "o4-mini": [1.1, 4.4],
    "gemini-2.0-flash": [0.075, 0.3], "gemini-2.5-pro": [1.25, 10],
  };
  for (const [prefix, rate] of Object.entries(PRICING)) {
    if (model.includes(prefix)) return rate;
  }
  return [1, 3];
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
