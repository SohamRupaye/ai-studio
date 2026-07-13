import type { BrowserWindow } from "electron";
import type { Store, GlobalMemory } from "@ai-studio/database";
import { Router } from "@ai-studio/providers";
import type { CostTracker, PermissionStore, PersonaRegistry, SnapshotManager } from "@ai-studio/ai-core";
import type { SkillsService, ToolRegistry } from "@ai-studio/tools-runtime";
import type { MetaGraph } from "@ai-studio/graph-engine";
import type { MCPServerEntry } from "@ai-studio/event-bus";

// ── Globals ───────────────────────────────────────────────────────────────────
// Shared mutable state, moved verbatim from index.ts. ES-module imports are
// read-only live bindings: any module reads these directly, but reassignment
// has to go through the matching setter below.

export let mainWindow: BrowserWindow | null = null;
export let store: Store;
export let router: Router;
export let graph: MetaGraph;
export let globalMem: GlobalMemory;
export let registry: ToolRegistry;
export let costTracker: CostTracker;
export let permissions: PermissionStore;
export let personas: PersonaRegistry;
export let snapshots: SnapshotManager;
export let skills: SkillsService;
export let dataDirPath = "";

export let nodeCounter = { current: 0 };
export let activeBranchId = "";
export let currentUserId = "";
export let currentProjectId = "";

export function setMainWindow(v: BrowserWindow | null) { mainWindow = v; }
export function setStore(v: Store) { store = v; }
export function setRouter(v: Router) { router = v; }
export function setGraph(v: MetaGraph) { graph = v; }
export function setGlobalMem(v: GlobalMemory) { globalMem = v; }
export function setRegistry(v: ToolRegistry) { registry = v; }
export function setCostTracker(v: CostTracker) { costTracker = v; }
export function setPermissions(v: PermissionStore) { permissions = v; }
export function setPersonas(v: PersonaRegistry) { personas = v; }
export function setSnapshots(v: SnapshotManager) { snapshots = v; }
export function setSkills(v: SkillsService) { skills = v; }
export function setDataDirPath(v: string) { dataDirPath = v; }
export function setActiveBranchId(v: string) { activeBranchId = v; }
export function setCurrentUserId(v: string) { currentUserId = v; }
export function setCurrentProjectId(v: string) { currentProjectId = v; }

/** Scope string for a chat-originated memory: project if known, else global. */
export function memoryScope(): "global" | `project:${string}` {
  return currentProjectId ? `project:${currentProjectId}` : "global";
}

/**
 * Per-organisation routers: an org with API keys of its own gets a router
 * built from global config + those overrides, so its chats hit the org's
 * accounts. Cached per org and invalidated when the org's keys change
 * (org:set-keys) or the base config is rewritten (config:update).
 */
export const orgRouters = new Map<string, { keysJson: string; router: Router }>();

export function routerFor(orgId: string | undefined): Router {
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

/** Serialize an MCPManager entry into the shape the frontend expects.
 * Headers are deliberately redacted — they can carry access tokens; the
 * renderer only learns whether one is set. */
export function toMCPServerEntry(entry: { config: any; status: any; tools: any[] }): MCPServerEntry {
  return {
    config: {
      name: entry.config.name,
      type: entry.config.type,
      enabled: entry.config.enabled,
      command: entry.config.command,
      args: entry.config.args,
      env: entry.config.env,
      url: entry.config.url,
      hasToken: Boolean(entry.config.headers?.Authorization),
      hasOauthClient: Boolean(entry.config.oauth?.clientId),
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
export function refreshModelsInBackground(forRouter: Router) {
  forRouter.refreshModels()
    .then(() => { mainWindow?.webContents.send("models:refreshed", undefined); })
    .catch((err) => { console.error("[models] Background refresh failed:", err?.message ?? err); });
}
