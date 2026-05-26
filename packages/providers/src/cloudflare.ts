/**
 * Cloudflare Workers AI Provider
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { OpenAICompatibleProvider } from "./openai_compatible.js";

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  /** Optional AI Gateway slug for logging/caching */
  gateway?: string;
}

export class CloudflareProvider implements Provider {
  private inner: OpenAICompatibleProvider;

  constructor(config: CloudflareConfig) {
    const baseUrl = config.gateway
      ? `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gateway}/workers-ai/v1`
      : `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`;
    this.inner = new OpenAICompatibleProvider({ apiKey: config.apiToken, baseUrl, name: "Cloudflare" });
  }

  call(...args: Parameters<Provider["call"]>) { return this.inner.call(...args); }
  stream(...args: Parameters<Provider["stream"]>) { return this.inner.stream(...args); }
}
