export type { Provider, ProviderMessage, StreamEvent, ContentBlock, TextContent, ImageContent, DocumentContent } from "./base.js";
export { ProviderRateLimitError, contentToText, imageBlocks, toAnthropicContent } from "./base.js";
export {
  CLAUDE_SUBSCRIPTION_ENTRY,
  CLAUDE_SUBSCRIPTION_MODELS,
  ClaudeSubscriptionProvider,
  bareClaudeModel,
  isClaudeSubscriptionModel,
  utilityModelFor,
} from "./claude_subscription.js";
export { detectLocalClaudeSession } from "./local-session.js";
export type { LocalClaudeSession, SessionSignal } from "./local-session.js";

// Core providers
export { AnthropicProvider } from "./anthropic.js";
export { OpenAIProvider } from "./openai.js";
export { GoogleProvider } from "./google.js";
export { CodexOAuthProvider } from "./codex_oauth.js";
export type { CodexAccountStatus } from "./codex_oauth.js";
export { OpenRouterProvider } from "./openrouter.js";

// Cloud providers
export { AzureOpenAIProvider } from "./azure.js";
export type { AzureConfig } from "./azure.js";
export { BedrockProvider } from "./bedrock.js";
export type { BedrockConfig } from "./bedrock.js";
export { VertexAIProvider } from "./vertex.js";
export type { VertexAIConfig } from "./vertex.js";
export { CloudflareProvider } from "./cloudflare.js";
export type { CloudflareConfig } from "./cloudflare.js";

// OpenAI-compatible providers (single factory for all)
export {
  OpenAICompatibleProvider,
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
export type { OpenAICompatibleConfig } from "./openai_compatible.js";

// Router
export { Router } from "./router.js";

// Config
export { getConfig, loadConfig, saveConfig, watchConfig, unwatchConfig, API_KEY_PROVIDERS } from "./config.js";
export type { Config, ApiKeyProvider, MCPServerConfigEntry } from "./config.js";

// Free models (via OpenRouter)
export {
  FREE_MODELS,
  DEFAULT_FREE_MODEL,
  FAST_FREE_MODEL,
  FALLBACK_FREE_MODEL,
  recommendFreeModel,
} from "./free_models.js";
export type { FreeModelId } from "./free_models.js";
