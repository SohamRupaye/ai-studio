import { API_KEY_PROVIDERS, getConfig } from "@ai-studio/providers";
import { handle } from "./handle.js";
import { store, globalMem, graph, orgRouters } from "../state.js";

export function registerWorkspaceHandlers() {
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
  // No name = a "New chat" placeholder that auto-titles off its first exchange.
  handle("chat:create", ({ projectId, name, spaceId }) => {
    const typed = name?.trim();
    return store.createChat(projectId, typed || "New chat", spaceId, getConfig().defaultModel, !typed);
  });
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
}
