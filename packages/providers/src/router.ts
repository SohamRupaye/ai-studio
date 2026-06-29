import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";
import { CodexOAuthProvider } from "./codex_oauth.js";
import { OpenRouterProvider } from "./openrouter.js";
import {
  createGroqProvider,
  createMistralProvider,
  createDeepInfraProvider,
  createCerebrasProvider,
  createTogetherAIProvider,
  createPerplexityProvider,
  createCohereProvider,
  createXAIProvider,
  createNVIDIAProvider,
  createFireworksProvider,
  createDeepSeekProvider,
  createAlibabaProvider,
} from "./openai_compatible.js";
import { FREE_MODELS } from "./free_models.js";
import { getConfig } from "./config.js";

interface ProviderEntry {
  name: string;
  prefixes: string[];
  provider: Provider;
  models: string[];
  /** Model ids are namespaced as "<name>/<id>" in the app; strip before the API call. */
  namespaced?: boolean;
  /** Original hardcoded fallback models, kept so a failed live refresh can restore them. */
  fallbackModels: string[];
  /** For OpenRouter-style entries where `prefixes` mirrors the exact model id list. */
  exactIdRouting?: boolean;
}

const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ModelCacheEntry {
  models: string[];
  fetchedAt: number;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(err: any): boolean {
  const msg = err?.message || "";
  if (/429|rate.limit/i.test(msg)) return true;
  if (/5\d\d/.test(msg)) return true;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Module-level cache so re-creating the Router (e.g. after config:set) doesn't
// force every provider to re-fetch its model list within the TTL window.
const modelCache = new Map<string, ModelCacheEntry>();

export class Router {
  private entries: ProviderEntry[] = [];
  private codexProvider: CodexOAuthProvider | null = null;

  register(name: string, prefixes: string[], provider: Provider, models: string[], opts?: { namespaced?: boolean; exactIdRouting?: boolean }) {
    const entry: ProviderEntry = {
      name, prefixes, provider, models,
      namespaced: opts?.namespaced,
      exactIdRouting: opts?.exactIdRouting,
      fallbackModels: models,
    };
    this.entries.push(entry);
    // A Router can be rebuilt mid-session (e.g. on config:set) while a
    // previous instance's live model fetch is still warm in the module-level
    // cache. Apply it immediately instead of reverting to the hardcoded
    // fallback list until the next async refreshModels() cycle completes —
    // otherwise a model the UI still shows as selected (from before the
    // rebuild) briefly fails to resolve.
    const cached = modelCache.get(name);
    if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
      this.applyModels(entry, cached.models);
    }
    if (provider instanceof CodexOAuthProvider) this.codexProvider = provider;
  }

  /** Access the Codex OAuth provider directly, for account status/login/logout UI actions. */
  getCodexProvider(): CodexOAuthProvider | null {
    return this.codexProvider;
  }

  /**
   * Refresh model lists from each provider's live API where supported.
   * Cached per provider name for MODEL_CACHE_TTL_MS so repeated calls (e.g.
   * after every config:set) don't hammer every provider's /models endpoint.
   * On fetch failure (offline, endpoint down, key revoked, no listModels()
   * support) the entry's original hardcoded list is kept untouched — this
   * never throws and never leaves an entry with zero models.
   */
  async refreshModels(): Promise<void> {
    await Promise.all(this.entries.map(async (entry) => {
      if (typeof entry.provider.listModels !== "function") return;

      const cached = modelCache.get(entry.name);
      if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
        this.applyModels(entry, cached.models);
        return;
      }

      try {
        const live = await entry.provider.listModels();
        if (!live.length) return; // treat empty response as failure, keep fallback
        modelCache.set(entry.name, { models: live, fetchedAt: Date.now() });
        this.applyModels(entry, live);
      } catch {
        // Network error, invalid key, rate limit, or no /models support —
        // silently keep entry.fallbackModels (already active from register()).
      }
    }));
  }

  /** Apply a freshly-fetched model list to an entry, updating exact-id prefixes/namespacing as needed. */
  private applyModels(entry: ProviderEntry, models: string[]): void {
    if (entry.exactIdRouting) {
      // OpenRouter-style: prefixes ARE the exact model ids.
      entry.prefixes = models;
      entry.models = models;
    } else if (entry.namespaced) {
      entry.models = models.map(id => `${entry.name}/${id}`);
      // prefixes stay as [`${name}/`] — no change needed.
    } else {
      entry.models = models;
      // prefixes stay as their semantic native form (e.g. ["claude"], ["gemini"]) — no change needed.
    }
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const entry = await this.resolveOrRefresh(model);
    const apiModel = this.apiModel(entry, model);
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await entry.provider.call(apiModel, messages, system, tools, signal);
      } catch (err: any) {
        lastErr = err;
        if (signal?.aborted) throw err;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const entry = await this.resolveOrRefresh(model);
    const apiModel = this.apiModel(entry, model);
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        yield* entry.provider.stream(apiModel, messages, system, tools, signal);
        return;
      } catch (err: any) {
        lastErr = err;
        if (signal?.aborted) throw err;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  listModels(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const entry of this.entries) {
      if (entry.models.length) out[entry.name] = entry.models;
    }
    return out;
  }

  private apiModel(entry: ProviderEntry, model: string): string {
    return entry.namespaced && model.startsWith(`${entry.name}/`)
      ? model.slice(entry.name.length + 1)
      : model;
  }

  private resolve(model: string): ProviderEntry | undefined {
    return this.entries.find(entry => entry.prefixes.some(p => model.startsWith(p)));
  }

  /**
   * Resolve a model to its provider entry, with a one-shot live-catalog
   * retry for exact-id-routed entries (OpenRouter) before giving up.
   * Exact-id entries only recognize models present in their last fetched
   * snapshot; that snapshot can be briefly stale relative to what the UI
   * shows as selected (e.g. right after app start, or a Router rebuild
   * whose background refresh hasn't landed yet). Rather than surface a
   * confusing "No provider" error for a model that's actually live on the
   * aggregator right now, do one on-demand refetch and retry the match.
   */
  private async resolveOrRefresh(model: string): Promise<ProviderEntry> {
    let entry = this.resolve(model);
    if (entry) return entry;

    for (const candidate of this.entries) {
      if (!candidate.exactIdRouting || typeof candidate.provider.listModels !== "function") continue;
      try {
        const live = await candidate.provider.listModels();
        if (live.length) {
          modelCache.set(candidate.name, { models: live, fetchedAt: Date.now() });
          this.applyModels(candidate, live);
        }
      } catch {
        // Network error, invalid key, rate limit — fall through to the final check below.
      }
    }

    entry = this.resolve(model);
    if (!entry) throw new Error(`No provider for model: ${model}.`);
    return entry;
  }

  /**
   * Build a router from config/env. Registration order matters: entries are
   * matched first-wins, so exact-id prefixes (OpenRouter's curated list)
   * register before namespace catch-alls that could shadow them.
   */
  static fromEnv(): Router {
    const cfg = getConfig();
    const keys = cfg.apiKeys;
    const router = new Router();

    // Codex OAuth — built in, no key required.
    const codex = new CodexOAuthProvider();
    router.register("codex_oauth", ["gpt-5", "codex"], codex, [
      "gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex", "gpt-5.2", "gpt-5.5",
    ]);

    // ── Direct providers (native model-id prefixes) ─────────────────────────

    if (keys.anthropic) {
      router.register("anthropic", ["claude"], new AnthropicProvider(keys.anthropic), [
        "claude-sonnet-4-20250514", "claude-haiku-4-20250514", "claude-opus-4-20250514",
      ]);
    }

    if (keys.openai) {
      router.register("openai", ["gpt-4", "o1", "o3", "o4"], new OpenAIProvider(keys.openai), [
        "gpt-4o", "gpt-4o-mini", "o3", "o4-mini",
      ]);
    }

    if (keys.google) {
      router.register("google", ["gemini"], new GoogleProvider(keys.google), [
        "gemini-2.5-pro", "gemini-2.0-flash",
      ]);
    }

    if (keys.mistral) {
      router.register("mistral", ["mistral", "codestral", "magistral", "devstral"], createMistralProvider(keys.mistral), [
        "mistral-large-latest", "mistral-medium-latest", "codestral-latest", "magistral-medium-latest",
      ]);
    }

    if (keys.deepseek) {
      router.register("deepseek", ["deepseek"], createDeepSeekProvider(keys.deepseek), [
        "deepseek-chat", "deepseek-reasoner",
      ]);
    }

    if (keys.xai) {
      router.register("xai", ["grok"], createXAIProvider(keys.xai), [
        "grok-4", "grok-3", "grok-3-mini",
      ]);
    }

    if (keys.cohere) {
      router.register("cohere", ["command"], createCohereProvider(keys.cohere), [
        "command-a-03-2025", "command-r-plus-08-2024",
      ]);
    }

    if (keys.perplexity) {
      router.register("perplexity", ["sonar"], createPerplexityProvider(keys.perplexity), [
        "sonar-pro", "sonar", "sonar-reasoning-pro",
      ]);
    }

    if (keys.alibaba) {
      router.register("alibaba", ["qwen"], createAlibabaProvider(keys.alibaba), [
        "qwen-max", "qwen-plus", "qwen-turbo",
      ]);
    }

    // ── OpenRouter (aggregator; ids are exact "vendor/model" strings) ───────
    // Registered before the namespaced hosts below so its exact ids (e.g.
    // "nvidia/…:free") win over the "nvidia/" namespace.

    if (keys.openrouter) {
      const freeIds = Object.keys(FREE_MODELS);
      router.register(
        "openrouter",
        freeIds,
        new OpenRouterProvider(keys.openrouter, { siteName: "AI Studio" }),
        freeIds,
        { exactIdRouting: true },
      );
    }

    // ── Multi-vendor inference hosts (namespaced ids, stripped at the API) ──

    const namespaced = (
      name: string,
      key: string,
      make: (k: string) => Provider,
      ids: string[],
    ) => {
      if (!key) return;
      router.register(name, [`${name}/`], make(key), ids.map(id => `${name}/${id}`), { namespaced: true });
    };

    namespaced("groq", keys.groq, createGroqProvider, [
      "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b",
    ]);
    namespaced("cerebras", keys.cerebras, createCerebrasProvider, [
      "llama-3.3-70b", "llama3.1-8b", "qwen-3-32b",
    ]);
    namespaced("together", keys.together, createTogetherAIProvider, [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ]);
    namespaced("fireworks", keys.fireworks, createFireworksProvider, [
      "accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3",
    ]);
    namespaced("deepinfra", keys.deepinfra, createDeepInfraProvider, [
      "meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct",
    ]);
    namespaced("nvidia", keys.nvidia, createNVIDIAProvider, [
      "meta/llama-3.3-70b-instruct", "qwen/qwen2.5-coder-32b-instruct",
    ]);

    return router;
  }
}
