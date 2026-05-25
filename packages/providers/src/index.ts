export type { Provider, ProviderMessage, StreamEvent } from "./base.js";

// Core providers
export { AnthropicProvider } from "./anthropic.js";
export { OpenAIProvider } from "./openai.js";
export { GoogleProvider } from "./google.js";
export { CodexOAuthProvider } from "./codex_oauth.js";
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
export { getConfig, loadConfig, watchConfig, unwatchConfig } from "./config.js";
export type { Config } from "./config.js";

// Free models (via OpenRouter)
export {
  FREE_MODELS,
  DEFAULT_FREE_MODEL,
  FAST_FREE_MODEL,
  FALLBACK_FREE_MODEL,
  recommendFreeModel,
} from "./free_models.js";
export type { FreeModelId } from "./free_models.js";
