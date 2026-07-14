import { Router, API_KEY_PROVIDERS, getConfig, saveConfig } from "@squirl/providers";
import { createRuntime } from "@squirl/ai-core";
import { handle } from "./handle.js";
import {
  store, router, registry, orgRouters, currentUserId,
  setRouter, setCurrentUserId, refreshModelsInBackground,
} from "../state.js";

export function registerSystemHandlers() {
  // ── User ────────────────────────────────────────────────────────────────────

  handle("user:get", () => {
    if (!currentUserId) return null;
    const name = store.getMeta("user_name") || "User";
    return { id: currentUserId, name };
  });

  handle("user:set", ({ name, email }) => {
    if (!currentUserId) {
      const { randomUUID } = require("node:crypto");
      setCurrentUserId(randomUUID());
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
    setRouter(Router.fromEnv());
    orgRouters.clear(); // org routers layer over the base config — rebuild them too
    refreshModelsInBackground(router);
    createRuntime(router, registry, cfg.defaultModel);
  });

  // ── Costs ───────────────────────────────────────────────────────────────────

  handle("costs:branch", ({ branchId }) => store.getCosts(branchId));
  handle("costs:project", ({ projectId }) => store.getProjectCosts(projectId));
}
