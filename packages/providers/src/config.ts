import { readFileSync, writeFileSync, existsSync, mkdirSync, watchFile, unwatchFile } from "node:fs";
import { join, dirname } from "node:path";
import { parse, stringify } from "yaml";

/**
 * Every provider that authenticates with a single API key.
 * (Codex OAuth is key-less; Azure/Bedrock/Vertex/Cloudflare take structured
 * configs and are wired via the `cloud:` section of config.yaml.)
 */
export const API_KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "groq",
  "mistral",
  "deepseek",
  "xai",
  "together",
  "fireworks",
  "cerebras",
  "perplexity",
  "cohere",
  "nvidia",
  "deepinfra",
  "alibaba",
] as const;

export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/** Environment variable consulted for each provider (takes precedence over YAML). */
const ENV_VARS: Record<ApiKeyProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "COHERE_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  alibaba: "DASHSCOPE_API_KEY",
};

export interface MCPServerConfigEntry {
  name: string;
  type: "stdio" | "sse" | "http";
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface Config {
  defaultModel: string;
  classifierModel: string;
  maxTokens: number;
  classifierMaxTokens: number;
  apiKeys: Record<ApiKeyProvider, string>;
  context: { hotWindow: number; hotTokenBudget: number; summaryEvery: number };
  classifier: { enabled: boolean };
  mcpServers: MCPServerConfigEntry[];
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
    if (server.type === "stdio" && !server.command) errors.push({ field: `mcpServers[${i}].command`, message: "required for stdio servers" });
    if ((server.type === "sse" || server.type === "http") && !server.url) errors.push({ field: `mcpServers[${i}].url`, message: "required for sse/http servers" });
  }
  return errors;
}

function readRaw(path: string): any {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf-8")) || {};
  } catch (e: any) {
    console.error(`[config] Failed to parse ${path}: ${e.message}`);
    return {};
  }
}

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? (_configPath || join(process.cwd(), "config.yaml"));
  _configPath = path;
  const raw = readRaw(path);

  const apiKeys = {} as Record<ApiKeyProvider, string>;
  for (const provider of API_KEY_PROVIDERS) {
    apiKeys[provider] = process.env[ENV_VARS[provider]] || raw.api_keys?.[provider] || "";
  }

  const cfg: Config = {
    defaultModel: process.env["AI_STUDIO_MODEL"] || raw.default_model || "gpt-5.4-mini",
    classifierModel: raw.classifier_model || "gpt-5.4-mini",
    maxTokens: Number(raw.max_tokens) || 8192,
    classifierMaxTokens: Number(raw.classifier_max_tokens) || 200,
    apiKeys,
    context: {
      hotWindow: Number(raw.context?.hot_window) || 10,
      hotTokenBudget: Number(raw.context?.hot_token_budget) || 8000,
      summaryEvery: Number(raw.context?.summary_every) || 10,
    },
    classifier: { enabled: raw.classifier?.enabled !== false },
    mcpServers: Array.isArray(raw.mcp_servers)
      ? raw.mcp_servers.map((s: any) => ({ type: "stdio", ...s }))
      : [],
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

/**
 * Persist a partial update into config.yaml and reload.
 * Only the fields present in the patch are touched; everything else in the
 * file (comments excluded — YAML is re-stringified) is preserved.
 * Empty-string API keys in the patch are ignored so the UI can submit its
 * whole form without wiping saved keys; pass `null` to explicitly clear one.
 */
export function saveConfig(patch: {
  apiKeys?: Partial<Record<ApiKeyProvider, string | null>>;
  defaultModel?: string;
  classifierEnabled?: boolean;
  mcpServers?: MCPServerConfigEntry[];
}): Config {
  const path = _configPath || join(process.cwd(), "config.yaml");
  _configPath = path;
  const raw = readRaw(path);

  if (patch.defaultModel) raw.default_model = patch.defaultModel;

  if (patch.classifierEnabled !== undefined) {
    raw.classifier = raw.classifier || {};
    raw.classifier.enabled = patch.classifierEnabled;
  }

  if (patch.mcpServers) {
    raw.mcp_servers = patch.mcpServers.map((s) => ({
      name: s.name,
      type: s.type,
      ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {}),
      ...(s.env ? { env: s.env } : {}),
      ...(s.url ? { url: s.url } : {}),
      ...(s.headers ? { headers: s.headers } : {}),
    }));
  }

  if (patch.apiKeys) {
    raw.api_keys = raw.api_keys || {};
    for (const provider of API_KEY_PROVIDERS) {
      const value = patch.apiKeys[provider];
      if (value === null) delete raw.api_keys[provider];
      else if (typeof value === "string" && value.trim()) raw.api_keys[provider] = value.trim();
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(raw), "utf-8");
  return loadConfig(path);
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
