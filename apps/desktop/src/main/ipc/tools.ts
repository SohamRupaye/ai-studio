import { dialog, shell } from "electron";
import { basename } from "node:path";
import { getConfig, saveConfig } from "@squirl/providers";
import type { MCPServerConfigEntry } from "@squirl/providers";
import {
  getMCPManager, addMCPServer, removeMCPServer, reconnectMCPServer, authenticateMCPServer,
} from "@squirl/tools-runtime";
import type { SkillImportOutcome } from "@squirl/event-bus";
import { handle } from "./handle.js";
import {
  mainWindow, registry, permissions, personas, snapshots, skills, store,
  toMCPServerEntry,
} from "../state.js";

export function registerToolingHandlers() {
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

  handle("mcp:set-token", async ({ name, token }) => {
    // Access-token connect for servers whose OAuth has no dynamic client
    // registration (GitHub, Slack, Figma). The token lives in config.yaml as
    // an Authorization header — same trust boundary as the provider API keys.
    const existing = getMCPManager().getServers().find((s) => s.config.name === name);
    if (!existing) throw new Error(`MCP server "${name}" not found`);
    const { Authorization: _replaced, ...keptHeaders } = existing.config.headers ?? {};
    const config: MCPServerConfigEntry = {
      ...(existing.config as MCPServerConfigEntry),
      headers: token.trim() ? { ...keptHeaders, Authorization: `Bearer ${token.trim()}` } : keptHeaders,
    };
    const entry = await addMCPServer(config, registry);
    const cfg = getConfig();
    saveConfig({ mcpServers: [...cfg.mcpServers.filter((s) => s.name !== name), config] });
    return toMCPServerEntry(entry);
  });

  handle("mcp:set-oauth-client", async ({ name, clientId, clientSecret }) => {
    // Pre-registered OAuth client (Google Cloud console, GitHub OAuth app…):
    // stored on the server's config.yaml entry; the sign-in flow prefers it
    // over dynamic registration. Follow with mcp:authenticate.
    const existing = getMCPManager().getServers().find((s) => s.config.name === name);
    if (!existing) throw new Error(`MCP server "${name}" not found`);
    const config: MCPServerConfigEntry = {
      ...(existing.config as MCPServerConfigEntry),
      oauth: { ...(existing.config as MCPServerConfigEntry).oauth, clientId: clientId.trim(), clientSecret: clientSecret?.trim() || undefined },
    };
    const entry = await addMCPServer(config, registry);
    const cfg = getConfig();
    saveConfig({ mcpServers: [...cfg.mcpServers.filter((s) => s.name !== name), config] });
    return toMCPServerEntry(entry);
  });

  handle("mcp:authenticate", async ({ name }) => {
    // Discovery + dynamic registration + PKCE happen in tools-runtime; we
    // open the system browser and await the loopback callback, then the
    // helper reconnects and re-registers the server's tools.
    const entry = await authenticateMCPServer(name, registry, (url) => shell.openExternal(url));
    if (!entry) throw new Error(`MCP server "${name}" not found`);
    return toMCPServerEntry(entry);
  });

  // ── Skills ──────────────────────────────────────────────────────────────────

  handle("skills:list", () => {
    const disabled = new Set(getConfig().disabledSkills);
    return skills.all().map((s) => ({
      name: s.name,
      description: s.description,
      enabled: !disabled.has(s.name),
      path: s.location,
      userOnly: s.userOnly,
    }));
  });

  handle("skills:read", ({ name }) => {
    const s = skills.get(name);
    return s ? { name: s.name, description: s.description, content: s.content } : null;
  });

  handle("skills:set-enabled", ({ name, enabled }) => {
    const disabled = new Set(getConfig().disabledSkills);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    saveConfig({ disabledSkills: [...disabled].sort() });
  });

  handle("skills:remove", async ({ name }) => {
    const removed = await skills.remove(name);
    if (removed) {
      // Drop the stale disabled entry so a future reinstall starts enabled,
      // like any newly installed skill.
      const disabled = getConfig().disabledSkills;
      if (disabled.includes(name)) saveConfig({ disabledSkills: disabled.filter((n) => n !== name) });
      mainWindow?.webContents.send("skills:changed", undefined);
    }
    return removed;
  });

  handle("skills:import", async () => {
    const outcome: SkillImportOutcome = { imported: [], skipped: [] };
    if (!mainWindow) return outcome;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Import skills",
      message: "Pick skill folders (containing a SKILL.md) or .md skill files",
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [{ name: "Skills", extensions: ["md"] }],
    });
    if (canceled) return outcome;
    for (const p of filePaths) {
      try {
        outcome.imported.push(await skills.importFromPath(p));
      } catch (err) {
        outcome.skipped.push({ source: basename(p), reason: err instanceof Error ? err.message : "Import failed." });
      }
    }
    if (outcome.imported.length) mainWindow?.webContents.send("skills:changed", undefined);
    return outcome;
  });

  handle("skills:discover", async ({ url }) => {
    const { skills: found, skipped } = await skills.discoverFromUrl(url);
    return {
      skills: found.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        installed: Boolean(skills.get(s.name)),
      })),
      skipped,
    };
  });

  handle("skills:pull", async ({ url, skills: pick }) => {
    const outcome = await skills.importFromUrl(url, pick);
    if (outcome.imported.length) mainWindow?.webContents.send("skills:changed", undefined);
    return outcome;
  });

  handle("skills:reveal", ({ name }) => {
    const s = skills.get(name);
    if (s) shell.showItemInFolder(s.location);
  });

  handle("skills:reload", async () => {
    await skills.load();
    return skills.all().length;
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
}
