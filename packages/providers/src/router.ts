import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";
import { CodexOAuthProvider } from "./codex_oauth.js";
import { getConfig } from "./config.js";

interface ProviderEntry {
  name: string;
  prefixes: string[];
  provider: Provider;
  models: string[];
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

export class Router {
  private entries: ProviderEntry[] = [];

  register(name: string, prefixes: string[], provider: Provider, models: string[]) {
    this.entries.push({ name, prefixes, provider, models });
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const provider = this.resolve(model);
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await provider.call(model, messages, system, tools, signal);
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
    const provider = this.resolve(model);
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        yield* provider.stream(model, messages, system, tools, signal);
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

  private resolve(model: string): Provider {
    for (const entry of this.entries) {
      if (entry.prefixes.some(p => model.startsWith(p))) return entry.provider;
    }
    throw new Error(`No provider for model: ${model}.`);
  }

  static fromEnv(): Router {
    const cfg = getConfig();
    const router = new Router();

    const codex = new CodexOAuthProvider();
    router.register("codex_oauth", ["gpt-5", "codex"], codex, [
      "gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex", "gpt-5.2", "gpt-5.5",
    ]);

    if (cfg.apiKeys.anthropic) {
      router.register("anthropic", ["claude"], new AnthropicProvider(cfg.apiKeys.anthropic), [
        "claude-sonnet-4-20250514", "claude-haiku-4-20250514", "claude-opus-4-20250514",
      ]);
    }

    if (cfg.apiKeys.openai) {
      router.register("openai", ["gpt-4", "o1", "o3", "o4"], new OpenAIProvider(cfg.apiKeys.openai), [
        "gpt-4o", "gpt-4o-mini", "o3", "o4-mini",
      ]);
    }

    if (cfg.apiKeys.google) {
      router.register("google", ["gemini"], new GoogleProvider(cfg.apiKeys.google), [
        "gemini-2.5-pro", "gemini-2.0-flash",
      ]);
    }

    return router;
  }
}
