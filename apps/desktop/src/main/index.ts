import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { Store, GlobalMemory } from "@ai-studio/database";
import { Router, API_KEY_PROVIDERS, getConfig, loadConfig, saveConfig, ProviderRateLimitError } from "@ai-studio/providers";
import type { MCPServerConfigEntry } from "@ai-studio/providers";
import {
  Agent, CostTracker, createRuntime, classifyAndIndex, loadPending, resumeQueue, loadNodeCounter,
  extractAndPersistArtifacts, runAgentCooperative, PermissionStore, PersonaRegistry, SnapshotManager,
} from "@ai-studio/ai-core";
import {
  createDefaultRegistry, loadMCPServers, getLSPClient, listSkills,
  getMCPManager, addMCPServer, removeMCPServer, reconnectMCPServer,
  kbListEntries, kbSearchEntries, kbAddEntry, kbRemoveEntry,
} from "@ai-studio/tools-runtime";
import { MetaGraph } from "@ai-studio/graph-engine";
import { buildPayload, compareBranches } from "@ai-studio/prompt-engine";
import { runPendingSummaries, shouldSummarize } from "@ai-studio/prompt-engine";
import type { ToolRegistry } from "@ai-studio/tools-runtime";
import type { IpcInvokeChannel, IpcInvokeRequest, IpcInvokeResponse, MCPServerEntry } from "@ai-studio/event-bus";

if (require("electron-squirrel-startup")) app.quit();

// ── Globals ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let store: Store;
let router: Router;
let graph: MetaGraph;
let globalMem: GlobalMemory;
let registry: ToolRegistry;
let costTracker: CostTracker;
let permissions: PermissionStore;
let personas: PersonaRegistry;
let snapshots: SnapshotManager;
let dataDirPath = "";
/** AbortController tagged with why it was aborted, so a superseded request
 * can tell the renderer (an explicit user Stop already handles its own UI). */
type ExtendedAbortController = AbortController & { supersededByNewMessage?: boolean };

let abortController: ExtendedAbortController | null = null;
let nodeCounter = { current: 0 };
let activeBranchId = "";
let currentUserId = "";
let currentProjectId = "";
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

/** Scope string for a chat-originated memory: project if known, else global. */
function memoryScope(): "global" | `project:${string}` {
  return currentProjectId ? `project:${currentProjectId}` : "global";
}

/**
 * Per-organisation routers: an org with API keys of its own gets a router
 * built from global config + those overrides, so its chats hit the org's
 * accounts. Cached per org and invalidated when the org's keys change
 * (org:set-keys) or the base config is rewritten (config:update).
 */
const orgRouters = new Map<string, { keysJson: string; router: Router }>();

function routerFor(orgId: string | undefined): Router {
  if (!orgId) return router;
  const keys = store.getOrgApiKeys(orgId);
  const entries = Object.entries(keys).filter(([, v]) => v);
  if (!entries.length) return router;
  const keysJson = JSON.stringify(entries.sort());
  const cached = orgRouters.get(orgId);
  if (cached && cached.keysJson === keysJson) return cached.router;
  const orgRouter = Router.fromEnv(Object.fromEntries(entries));
  orgRouters.set(orgId, { keysJson, router: orgRouter });
  return orgRouter;
}

/** Serialize an MCPManager entry into the shape the frontend expects. */
function toMCPServerEntry(entry: { config: any; status: any; tools: any[] }): MCPServerEntry {
  return {
    config: {
      name: entry.config.name,
      type: entry.config.type,
      enabled: entry.config.enabled,
      command: entry.config.command,
      args: entry.config.args,
      env: entry.config.env,
      url: entry.config.url,
      headers: entry.config.headers,
    },
    status: entry.status,
    tools: entry.tools.map((t: any) => ({ name: t.name, description: t.description })),
  };
}

/**
 * Fire-and-forget refresh of live model lists from each provider's API.
 * Non-blocking so app startup / config:set never waits on network calls —
 * providers fall back to their hardcoded model list until (and unless) this
 * resolves, then the renderer is notified to refetch models:list.
 */
function refreshModelsInBackground(forRouter: Router) {
  forRouter.refreshModels()
    .then(() => { mainWindow?.webContents.send("models:refreshed", undefined); })
    .catch((err) => { console.error("[models] Background refresh failed:", err?.message ?? err); });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.setWindowButtonVisibility(true);
  mainWindow.on("enter-full-screen", () => { mainWindow?.webContents.send("window:fullscreen-changed", true); });
  mainWindow.on("leave-full-screen", () => { mainWindow?.webContents.send("window:fullscreen-changed", false); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Runtime init ──────────────────────────────────────────────────────────────

async function initRuntime() {
  const dataDir = join(app.getPath("userData"), "data");
  dataDirPath = dataDir;
  // Config must live alongside the rest of the app's persisted data, not in
  // process.cwd() (which is unpredictable for a packaged/dev Electron app and
  // caused saved provider keys to silently vanish on restart).
  const cfg = loadConfig(join(app.getPath("userData"), "config.yaml"));

  store = new Store(join(dataDir, "workspace.db"));
  router = Router.fromEnv();
  refreshModelsInBackground(router);
  graph = new MetaGraph(join(dataDir, "graphs"));
  globalMem = new GlobalMemory(dataDir);
  costTracker = new CostTracker();
  permissions = new PermissionStore(dataDir);
  personas = new PersonaRegistry([dataDir]);
  snapshots = new SnapshotManager();

  registry = createDefaultRegistry();

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
        "Persist a durable fact about the user or their preferences to long-term memory so it is available in every future conversation. Call this whenever the user asks you to remember, save, note, or store something about them (preferences, constraints, personal details, travel dates, etc.). Phrase the fact as a standalone statement.",
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
    // If a prior request is still in flight, it's being superseded by this
    // new message (not a user-initiated Stop) — tag the OLD controller so
    // its own loop (holding a reference to it) knows to notify the renderer
    // instead of hanging silently forever.
    if (abortController && !abortController.signal.aborted) {
      abortController.supersededByNewMessage = true;
      abortController.abort();
    }
    const myController: ExtendedAbortController = new AbortController();
    abortController = myController;
    const signal = myController.signal;

    store.addMessage(branchId, "user", message);
    // Turn number of the user message this invocation is answering — threaded
    // through every error event below so the renderer can mark specifically
    // THIS message (not whichever one is currently last) as failed.
    const userTurn = store.getMessageCount(branchId) - 1;
    const branch = store.getBranch(branchId);
    if (!branch) {
      mainWindow.webContents.send("chat:stream", { type: "error", branchId, message: `Branch ${branchId} not found`, turn: userTurn });
      return;
    }

    // Track the project this branch belongs to, for scoping memories.
    currentProjectId = branch.chatId ? (store.getChat(branch.chatId)?.projectId ?? "") : "";

    const payload = await buildPayload(store, branch, graph, globalMem, message);
    const cfg = getConfig();
    const model = branch.model || cfg.defaultModel;
    // Org-level API keys override the globals: this chat runs on its org's router.
    const chatRouter = routerFor(
      currentProjectId ? store.getProject(currentProjectId)?.orgId : undefined,
    );
    createRuntime(chatRouter, registry, model);

    // Active persona for this branch (if any) layers its own system prompt
    // ahead of the base instructions and restricts which tools it can see.
    const activePersonaName = store.getMeta(`persona:${branchId}`) || "default";
    const persona = personas.get(activePersonaName);

    // Project-level custom instructions (set in project settings) sit between
    // the app boilerplate and the per-conversation context.
    const projectPrompt = (currentProjectId ? store.getProject(currentProjectId)?.systemPrompt : undefined)?.trim();
    const baseSystem = `You are a helpful AI assistant in AI Studio, a desktop AI workspace. Use your tools to help the user accomplish tasks.\n\nMEMORY: When the user asks you to remember, save, note, or store a fact about them or their preferences, you MUST call the \`remember\` tool to persist it — never just say you will remember without calling it. To recall what you know about the user, call \`recall_memories\`. Persisted memories are durable across all conversations.\n\n${projectPrompt ? `PROJECT INSTRUCTIONS (set by the user for this project):\n${projectPrompt}\n\n` : ""}${payload.systemContext}`;
    const system = persona && persona.name !== "default"
      ? `${persona.systemPrompt}\n\n${baseSystem}`
      : baseSystem;
    // sessionId scopes snapshot tracking (write_file/edit_file/patch) to this branch.
    const agent = new Agent(chatRouter, registry, { sessionId: branchId });

    try {
      for await (const event of runAgentCooperative(agent, model, payload.messages, system, signal)) {
        if (signal.aborted) {
          // Only notify the renderer if this request was superseded by a
          // newer message — an explicit user Stop already cleans up its own
          // UI client-side and doesn't need (or want) an error toast here.
          if (myController.supersededByNewMessage) {
            mainWindow?.webContents.send("chat:stream", { type: "error", branchId, message: "Cancelled — a newer message was sent.", turn: userTurn });
          }
          break;
        }
        if (event.type === "text" || event.type === "tool_start" || event.type === "tool_end" || event.type === "tool_call_streaming") {
          mainWindow?.webContents.send("chat:stream", { ...event, branchId });
        } else if (event.type === "done") {
          if (!event.result.text && !event.result.toolCalls.length) {
            mainWindow?.webContents.send("chat:stream", {
              type: "error",
              branchId,
              message: `${model} returned an empty response. This can happen with free-tier models under load — try again or switch models.`,
              turn: userTurn,
            });
            break;
          }
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
            type: "done", branchId, text: assistantText, iterations: event.result.iterations, cost: lastEntry,
          });

          // Classify + index
          const turnNum = store.getMessageCount(branchId) - 1;
          classifyAndIndex(router, graph, nodeCounter, message, assistantText, branchId, turnNum);

          // Deterministic memory capture — guarantees an explicit "remember X"
          // request is persisted even if the model didn't call the remember tool.
          try {
            const calledRemember =
              Array.isArray((event.result as any).toolCalls) &&
              (event.result as any).toolCalls.some((tc: any) => tc.name === "remember");
            if (!calledRemember) {
              const fact = extractMemoryFact(message);
              if (fact) globalMem.add(fact, memoryScope());
            }
          } catch { /* non-fatal */ }

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
        mainWindow?.webContents.send("chat:stream", {
          type: "error",
          branchId,
          message: err.message,
          turn: userTurn,
          rateLimited: err instanceof ProviderRateLimitError,
          retryAfterSeconds: err instanceof ProviderRateLimitError ? err.retryAfterSeconds : undefined,
        });
      }
    }
  });

  handle("chat:abort", () => { abortController?.abort(); abortController = null; });

  // ── Organisations ───────────────────────────────────────────────────────────

  handle("org:list", () => store.listOrganisations());
  handle("org:create", ({ name }) => store.createOrganisation(name));
  handle("org:rename", ({ id, name }) => { store.renameOrganisation(id, name); });
  handle("org:impact", ({ id }) => {
    // Sum the org's projects' impacts, plus each project's scoped memories.
    const projects = store.listProjects(id);
    let spaces = 0, chats = 0, artifacts = 0, memories = 0;
    for (const project of projects) {
      const impact = store.projectImpact(project.id);
      spaces += impact.spaceIds.length;
      chats += impact.chatIds.length;
      artifacts += impact.artifacts;
      const scopes = new Set<string>(projectMemoryScopes(project.id, impact));
      memories += globalMem.list().filter((f) => scopes.has(f.scope)).length;
    }
    return { projects: projects.length, spaces, chats, artifacts, memories };
  });
  handle("org:delete", ({ id }) => {
    // HARD delete, one project at a time (each purge takes its memories and
    // graph nodes along). The last organisation can't be deleted — the app
    // needs somewhere to stand.
    if (store.listOrganisations().length <= 1) return false;
    if (!store.getOrganisation(id)) return false;
    // ALL project rows, soft-deleted included — leftovers from the
    // soft-delete era otherwise block the org row's FK.
    for (const projectId of store.listProjectIds(id)) hardDeleteProject(projectId);
    orgRouters.delete(id);
    return store.deleteOrganisation(id);
  });
  handle("org:keys", ({ id }) => {
    const keys = store.getOrgApiKeys(id);
    return Object.fromEntries(API_KEY_PROVIDERS.map((p) => [p, Boolean(keys[p])]));
  });
  handle("org:set-keys", ({ id, keys }) => {
    store.setOrgApiKeys(id, keys);
    orgRouters.delete(id); // rebuild this org's router with the new keys
  });

  // ── Projects ────────────────────────────────────────────────────────────────

  handle("project:list", ({ orgId }) => store.listProjects(orgId));
  handle("project:create", ({ orgId, name }) => {
    const project = store.createProject(orgId, name);
    // Every project starts with a home for chats so the sidebar is never empty.
    store.createSpace(project.id, "General");
    return project;
  });
  handle("project:get", ({ id }) => store.getProject(id) ?? null);
  handle("project:rename", ({ id, name }) => { store.renameProject(id, name); });
  handle("project:update", ({ id, ...patch }) => { store.updateProject(id, patch); });
  handle("project:reorder", ({ orgId, ids }) => { store.reorderProjects(orgId, ids); });

  const projectMemoryScopes = (projectId: string, impact: { chatIds: string[]; branchIds: string[] }) => [
    `project:${projectId}` as const,
    ...impact.chatIds.map((chatId) => `chat:${chatId}` as const),
    ...impact.branchIds.map((branchId) => `branch:${branchId}` as const),
  ];
  handle("project:impact", ({ id }) => {
    const impact = store.projectImpact(id);
    const scopes = new Set<string>(projectMemoryScopes(id, impact));
    return {
      spaces: impact.spaceIds.length,
      chats: impact.chatIds.length,
      artifacts: impact.artifacts,
      memories: globalMem.list().filter((f) => scopes.has(f.scope)).length,
    };
  });
  // Unlike space/chat deletion this is a HARD delete: the store returns the
  // purged ids (soft-deleted rows included) and we take the scoped memories
  // and the knowledge-graph nodes with them. Gated by a typed challenge in
  // the UI. Shared with org:delete, which empties the org project by project.
  const hardDeleteProject = (id: string): boolean => {
    const purged = store.deleteProject(id);
    if (purged) {
      globalMem.removeScopes(projectMemoryScopes(id, purged));
      graph.removeByBranches(purged.branchIds);
    }
    return purged !== null;
  };
  handle("project:delete", ({ id }) => hardDeleteProject(id));
  handle("project:move", ({ id, orgId }) => { store.moveProject(id, orgId); });

  // ── Window ──────────────────────────────────────────────────────────────────

  handle("window:is-fullscreen", () => mainWindow?.isFullScreen() ?? false);

  // ── Spaces ──────────────────────────────────────────────────────────────────

  handle("space:list", ({ projectId }) => store.listSpaces(projectId));
  handle("space:create", ({ projectId, name }) => store.createSpace(projectId, name));
  handle("space:rename", ({ id, name }) => { store.renameSpace(id, name); });

  // Memories scoped to a space's chats/branches live in GlobalMemory, not the
  // store — resolve those scopes from the store's impact ids.
  const spaceMemoryScopes = (impact: { chatIds: string[]; branchIds: string[] }) => [
    ...impact.chatIds.map((chatId) => `chat:${chatId}` as const),
    ...impact.branchIds.map((branchId) => `branch:${branchId}` as const),
  ];
  handle("space:impact", ({ id }) => {
    const impact = store.spaceImpact(id);
    const scopes = new Set<string>(spaceMemoryScopes(impact));
    return {
      chats: impact.chatIds.length,
      artifacts: impact.artifacts,
      memories: globalMem.list().filter((f) => scopes.has(f.scope)).length,
    };
  });
  handle("space:delete", ({ id }) => {
    // Take the impact before the delete marks the rows — the ids drive the
    // memory purge. Knowledge-graph entries are deliberately left alone.
    const impact = store.spaceImpact(id);
    const deleted = store.deleteSpace(id);
    if (deleted) globalMem.removeScopes(spaceMemoryScopes(impact));
    return deleted;
  });

  // ── Chats ───────────────────────────────────────────────────────────────────

  handle("chat:list", ({ projectId }) => store.listChats(projectId));
  // New chats are born on a "main" branch carrying the current default model.
  handle("chat:create", ({ projectId, name, spaceId }) =>
    store.createChat(projectId, name, spaceId, getConfig().defaultModel));
  handle("chat:rename", ({ id, name }) => { store.renameChat(id, name); });

  const chatMemoryScopes = (chatId: string, branchIds: string[]) => [
    `chat:${chatId}` as const,
    ...branchIds.map((branchId) => `branch:${branchId}` as const),
  ];
  handle("chat:impact", ({ id }) => {
    const impact = store.chatImpact(id);
    const scopes = new Set<string>(chatMemoryScopes(id, impact.branchIds));
    return {
      branches: impact.branches,
      artifacts: impact.artifacts,
      memories: globalMem.list().filter((f) => scopes.has(f.scope)).length,
    };
  });
  handle("chat:delete", ({ id }) => {
    // Impact before delete — the ids drive the memory purge, same as spaces.
    const impact = store.chatImpact(id);
    const deleted = store.deleteChat(id);
    if (deleted) globalMem.removeScopes(chatMemoryScopes(id, impact.branchIds));
    return deleted;
  });

  handle("branch:fork", ({ branchId, name }) => {
    // Fork at the current head so the new branch inherits the whole
    // conversation up to this point.
    const parent = store.getBranch(branchId);
    if (!parent) throw new Error("Branch not found");
    const messageCount = store.getMessageCount(branchId);
    return store.createBranch(
      name,
      parent.model,
      branchId,
      messageCount > 0 ? messageCount - 1 : undefined,
      parent.chatId,
    );
  });

  handle("branch:export", async ({ id }) => {
    const branch = store.getBranch(id);
    if (!branch || !mainWindow) return null;
    const chat = branch.chatId ? store.getChat(branch.chatId) : undefined;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${chat ? `${chat.name}-` : ""}${branch.name}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (canceled || !filePath) return null;

    const lines: string[] = [`# ${chat ? `${chat.name} — ` : ""}${branch.name}`, ""];
    for (const msg of store.getMessages(id)) {
      const speaker = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
      lines.push(`**${speaker}:**`, "", msg.content, "");
    }
    writeFileSync(filePath, lines.join("\n"));
    return filePath;
  });

  // ── Branches ────────────────────────────────────────────────────────────────

  handle("branch:list", () => store.listBranches());
  handle("branch:create", ({ name, model, parentId, forkAtIndex, chatId }) => store.createBranch(name, model, parentId, forkAtIndex, chatId));
  handle("branch:delete", ({ id }) => store.deleteBranch(id));
  handle("branch:rename", ({ id, name }) => { store.updateBranchName(id, name); });
  handle("branch:update-model", ({ id, model }) => { store.updateBranchModel(id, model); });
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

  handle("message:list", ({ branchId }) => store.getMessages(branchId).map(m => ({ id: m.id, role: m.role, content: m.content, turn: m.turn, timestamp: m.timestamp })));
  handle("message:undo", ({ branchId }) => store.undoLastTurn(branchId));
  handle("message:edit", ({ branchId, turn }) => { store.editMessage(branchId, turn); });
  handle("message:delete", ({ branchId, turn }) => store.deleteMessagePair(branchId, turn));

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

  // Selection menus get the catalogue minus the user's disabled models;
  // routing is deliberately unfiltered so pinned branches keep working.
  handle("models:list", () => {
    const disabled = getConfig().disabledModels;
    return Object.fromEntries(
      Object.entries(router.listModels()).map(([entry, models]) => {
        const hidden = new Set(disabled[entry] ?? []);
        return [entry, hidden.size ? models.filter((m) => !hidden.has(m)) : models];
      }),
    );
  });
  handle("models:all", () => router.listModels());

  // ── Codex OAuth account ──────────────────────────────────────────────────────

  handle("codex:status", () => router.getCodexProvider()?.getStatus() ?? { connected: false });

  handle("codex:login", async () => {
    const codex = router.getCodexProvider();
    if (!codex) return { connected: false };
    await codex.login();
    return codex.getStatus();
  });

  handle("codex:logout", () => {
    router.getCodexProvider()?.logout();
  });

  handle("codex:switch-account", async () => {
    const codex = router.getCodexProvider();
    if (!codex) return { connected: false };
    await codex.switchAccount();
    return codex.getStatus();
  });

  // ── Config ──────────────────────────────────────────────────────────────────

  handle("config:get", () => {
    const cfg = getConfig();
    return {
      defaultModel: cfg.defaultModel,
      classifierEnabled: cfg.classifier.enabled,
      mcpServers: cfg.mcpServers,
      disabledModels: cfg.disabledModels,
    };
  });

  handle("config:keys", () => {
    const keys = getConfig().apiKeys;
    return Object.fromEntries(API_KEY_PROVIDERS.map((p) => [p, Boolean(keys[p])]));
  });

  handle("config:set", (payload) => {
    // Persist the patch (API keys, mcpServers, classifierEnabled, defaultModel)
    // to config.yaml, then reload and rebuild the router so new keys take
    // effect immediately without an app restart.
    saveConfig(payload as Parameters<typeof saveConfig>[0]);
    const cfg = getConfig();
    router = Router.fromEnv();
    orgRouters.clear(); // org routers layer over the base config — rebuild them too
    refreshModelsInBackground(router);
    createRuntime(router, registry, cfg.defaultModel);
  });

  // ── Costs ───────────────────────────────────────────────────────────────────

  handle("costs:branch", ({ branchId }) => store.getCosts(branchId));
  handle("costs:project", ({ projectId }) => store.getProjectCosts(projectId));

  // ── MCP servers ─────────────────────────────────────────────────────────────

  handle("mcp:list", () => getMCPManager().getServers().map(toMCPServerEntry));

  handle("mcp:add", async (config) => {
    const entry = await addMCPServer(config as MCPServerConfigEntry, registry);
    // Persist to config.yaml so it reconnects on next launch.
    const cfg = getConfig();
    const existing = cfg.mcpServers.filter((s) => s.name !== config.name);
    saveConfig({ mcpServers: [...existing, config as MCPServerConfigEntry] });
    return toMCPServerEntry(entry);
  });

  handle("mcp:remove", async ({ name }) => {
    await removeMCPServer(name);
    const cfg = getConfig();
    saveConfig({ mcpServers: cfg.mcpServers.filter((s) => s.name !== name) });
  });

  handle("mcp:reconnect", async ({ name }) => {
    const entry = await reconnectMCPServer(name, registry);
    if (!entry) throw new Error(`MCP server "${name}" not found`);
    return toMCPServerEntry(entry);
  });

  // ── Skills ──────────────────────────────────────────────────────────────────

  handle("skills:list", () => {
    const skillsDir = join(dataDirPath, "skills");
    return listSkills(skillsDir).map((s) => ({ name: s.name, description: s.description, tools: s.tools }));
  });

  // ── Permissions ─────────────────────────────────────────────────────────────

  handle("permissions:list", () => permissions.list());
  handle("permissions:remove", ({ tool, pattern }) => permissions.remove(tool, pattern));
  handle("permissions:clear", () => { permissions.clear(); });

  // ── Snapshots ───────────────────────────────────────────────────────────────

  handle("snapshot:list", ({ branchId }) =>
    snapshots.list(branchId).map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      files: s.files.map((f) => ({ path: f.path, action: (f.originalContent === null ? "delete" : "restore") as "restore" | "delete" })),
      createdAt: s.createdAt,
      description: s.description,
    })),
  );
  handle("snapshot:diff", ({ snapshotId }) => snapshots.diff(snapshotId));
  handle("snapshot:revert", ({ snapshotId }) => snapshots.revert(snapshotId));

  // ── Personas ────────────────────────────────────────────────────────────────

  handle("persona:list", () =>
    personas.list().map((p) => ({
      name: p.name, description: p.description, model: p.model,
      allowedTools: p.allowedTools, deniedTools: p.deniedTools,
    })),
  );
  handle("persona:get-active", ({ branchId }) => store.getMeta(`persona:${branchId}`) || "default");
  handle("persona:set-active", ({ branchId, name }) => {
    if (!personas.get(name)) throw new Error(`Unknown persona: ${name}`);
    store.setMeta(`persona:${branchId}`, name);
  });

  // ── Knowledge base ──────────────────────────────────────────────────────────

  handle("kb:list", ({ category, tags }) => kbListEntries(dataDirPath, category, tags));
  handle("kb:search", ({ query, category, tags }) => kbSearchEntries(dataDirPath, query, category, tags));
  handle("kb:add", ({ title, content, category, tags }) => kbAddEntry(dataDirPath, { title, content, category, tags }));
  handle("kb:remove", ({ id }) => kbRemoveEntry(dataDirPath, id));
}

// ── Memory extraction helper ──────────────────────────────────────────────────

/**
 * Extract the fact from an explicit, self-contained "remember X" style
 * request. Returns null when the message isn't a memory-save request, OR
 * when it refers to prior conversation content ("these bits", "that",
 * "the above", "it") that this regex-based extractor cannot resolve — in
 * that case the model's own `remember` tool call is the only reliable path,
 * and saving the literal directive sentence would be worse than saving
 * nothing.
 */
const LEADING_MEMORY_DIRECTIVE =
  /^(please\s+)?(can you\s+|could you\s+|pls\s+)?(add\s+(?:this\s+)?(?:to|in|into)?\s*(?:the\s+)?memory|remember|note|save|store|keep in mind|memori[sz]e|don'?t forget)\b/i;

function extractMemoryFact(message: string): string | null {
  const msg = message.trim();

  // Must OPEN with an explicit save directive. Matching the trigger word
  // anywhere in the message (the previous approach) false-positives on
  // messages that merely mention "remember"/"save"/etc. without asking for
  // anything to be saved — e.g. "I never said to remember anything" would
  // itself get saved as a "fact", verbatim.
  if (!LEADING_MEMORY_DIRECTIVE.test(msg)) return null;

  // Bail out on references to prior context this extractor can't resolve —
  // "save these bits", "remember that [we discussed]" (no clause after
  // "that"), "note the above", "keep it in mind". Extracting the literal
  // sentence in these cases would save the directive itself as the "fact",
  // which is worse than saving nothing — only the model's own `remember`
  // tool call (which has the actual conversation context) can do this right.
  const hasThatClause = /\bthat\s+\S+/i.test(msg);
  const isReferential = /\b(this|these|it|the above|those)\b/i.test(msg) || (/\bthat\b/i.test(msg) && !hasThatClause);
  if (isReferential) return null;

  // Prefer the clause after the LAST "that" (handles "remember that again that X").
  const afterThat = msg.match(/^.*\bthat\b\s+(.+)$/i);
  let fact = afterThat ? afterThat[1] : msg;

  // Otherwise strip a leading directive phrase.
  if (!afterThat) {
    fact = fact.replace(
      /^(please\s+)?(can you\s+|could you\s+|pls\s+)?(add\s+(?:this\s+)?(?:to|in|into)?\s*(?:the\s+)?memory|remember|note|save|store|keep in mind|memori[sz]e)\b[:,\-\s]*/i,
      "",
    );
  }

  fact = fact.replace(/\s+/g, " ").replace(/[?.!,\s]+$/g, "").trim();
  // Guard against empty or non-substantive extractions.
  if (fact.length < 3) return null;
  return fact;
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
