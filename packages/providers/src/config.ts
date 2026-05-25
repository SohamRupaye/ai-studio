import { readFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface Config {
  defaultModel: string;
  classifierModel: string;
  maxTokens: number;
  classifierMaxTokens: number;
  apiKeys: { anthropic: string; openai: string; google: string };
  context: { hotWindow: number; hotTokenBudget: number; summaryEvery: number };
  classifier: { enabled: boolean };
  mcpServers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>;
}

interface ValidationError {
  field: string;
  message: string;
}

let _config: Config | null = null;
let _configPath = "";
let _onReload: (() => void) | null = null;

function validate(cfg: Config): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!cfg.defaultModel || typeof cfg.defaultModel !== "string") {
    errors.push({ field: "defaultModel", message: "must be a non-empty string" });
  }
  if (cfg.maxTokens < 100 || cfg.maxTokens > 1_000_000) {
    errors.push({ field: "maxTokens", message: "must be between 100 and 1,000,000" });
  }
  if (cfg.context.hotWindow < 1 || cfg.context.hotWindow > 100) {
    errors.push({ field: "context.hotWindow", message: "must be between 1 and 100" });
  }
  for (const [i, server] of cfg.mcpServers.entries()) {
    if (!server.name) errors.push({ field: `mcpServers[${i}].name`, message: "required" });
    if (!server.command) errors.push({ field: `mcpServers[${i}].command`, message: "required" });
  }
  return errors;
}

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? (_configPath || join(process.cwd(), "config.yaml"));
  _configPath = path;
  let raw: any = {};
  if (existsSync(path)) {
    try {
      raw = parse(readFileSync(path, "utf-8")) || {};
    } catch (e: any) {
      console.error(`[config] Failed to parse ${path}: ${e.message}`);
    }
  }

  const cfg: Config = {
    defaultModel: process.env["AI_STUDIO_MODEL"] || raw.default_model || "gpt-5.4-mini",
    classifierModel: raw.classifier_model || "gpt-5.4-mini",
    maxTokens: Number(raw.max_tokens) || 8192,
    classifierMaxTokens: Number(raw.classifier_max_tokens) || 200,
    apiKeys: {
      anthropic: process.env["ANTHROPIC_API_KEY"] || raw.api_keys?.anthropic || "",
      openai: process.env["OPENAI_API_KEY"] || raw.api_keys?.openai || "",
      google: process.env["GOOGLE_API_KEY"] || raw.api_keys?.google || "",
    },
    context: {
      hotWindow: Number(raw.context?.hot_window) || 10,
      hotTokenBudget: Number(raw.context?.hot_token_budget) || 8000,
      summaryEvery: Number(raw.context?.summary_every) || 10,
    },
    classifier: { enabled: raw.classifier?.enabled !== false },
    mcpServers: Array.isArray(raw.mcp_servers) ? raw.mcp_servers : [],
  };

  const errors = validate(cfg);
  if (errors.length) {
    console.warn(`[config] Validation warnings:`);
    for (const e of errors) console.warn(`  ${e.field}: ${e.message}`);
  }

  _config = cfg;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}

/** Watch config file for changes and reload automatically. */
export function watchConfig(onChange?: () => void): void {
  _onReload = onChange || null;
  if (!_configPath || !existsSync(_configPath)) return;
  watchFile(_configPath, { interval: 2000 }, () => {
    console.log("[config] Reloading config...");
    loadConfig(_configPath);
    _onReload?.();
  });
}

export function unwatchConfig(): void {
  if (_configPath) unwatchFile(_configPath);
}
