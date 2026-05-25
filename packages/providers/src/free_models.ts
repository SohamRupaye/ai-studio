/**
 * Free Models - Zero-cost model access via OpenRouter free tier
 * These models require only an OpenRouter API key (free to create)
 * Default model is set for best coding/agentic performance
 */

/** All available free models on OpenRouter (append :free to model ID) */
export const FREE_MODELS = {
  // Top-tier free models (frontier-class)
  "nvidia/nemotron-3-ultra-550b-a55b:free": {
    name: "NVIDIA Nemotron 3 Ultra",
    params: "550B (55B active)",
    context: 1_000_000,
    strengths: ["reasoning", "agentic", "coding", "orchestration"],
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    name: "NVIDIA Nemotron 3 Super",
    params: "120B (12B active)",
    context: 1_000_000,
    strengths: ["multi-agent", "coding", "efficiency"],
  },
  "openai/gpt-oss-120b:free": {
    name: "OpenAI GPT-OSS 120B",
    params: "117B MoE (5.1B active)",
    context: 131_000,
    strengths: ["reasoning", "tool-use", "general"],
  },
  "poolside/laguna-m.1:free": {
    name: "Poolside Laguna M.1",
    params: "Flagship",
    context: 262_000,
    strengths: ["coding", "tool-calling", "agentic"],
  },
  "moonshotai/kimi-k2.6:free": {
    name: "Kimi K2.6",
    params: "MoE",
    context: 262_000,
    strengths: ["coding", "multi-agent", "UI generation"],
  },

  // Strong mid-tier free models
  "openai/gpt-oss-20b:free": {
    name: "OpenAI GPT-OSS 20B",
    params: "21B MoE (3.6B active)",
    context: 131_000,
    strengths: ["fast", "tool-use", "reasoning"],
  },
  "nvidia/nemotron-3-nano-30b-a3b:free": {
    name: "NVIDIA Nemotron 3 Nano",
    params: "30B (3B active)",
    context: 256_000,
    strengths: ["efficiency", "agentic", "customizable"],
  },
  "google/gemma-4-31b-it:free": {
    name: "Google Gemma 4 31B",
    params: "30.7B dense",
    context: 262_000,
    strengths: ["multilingual", "reasoning", "coding"],
  },
  "google/gemma-4-26b-a4b-it:free": {
    name: "Google Gemma 4 26B MoE",
    params: "25.2B (3.8B active)",
    context: 262_000,
    strengths: ["multimodal", "efficient", "function-calling"],
  },
  "z-ai/glm-4.5-air:free": {
    name: "Z.ai GLM 4.5 Air",
    params: "MoE",
    context: 131_000,
    strengths: ["agentic", "reasoning", "tool-use"],
  },
  "poolside/laguna-xs.2:free": {
    name: "Poolside Laguna XS.2",
    params: "Compact",
    context: 262_000,
    strengths: ["coding", "fast", "tool-calling"],
  },
  "nvidia/nemotron-nano-9b-v2:free": {
    name: "NVIDIA Nemotron Nano 9B v2",
    params: "9B",
    context: 128_000,
    strengths: ["compact", "reasoning", "configurable"],
  },

  // Multimodal free models
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
    name: "NVIDIA Nemotron 3 Nano Omni",
    params: "30B (3B active)",
    context: 256_000,
    strengths: ["multimodal", "video", "audio", "reasoning"],
  },
  "nvidia/nemotron-nano-12b-v2-vl:free": {
    name: "NVIDIA Nemotron Nano 12B VL",
    params: "12B",
    context: 128_000,
    strengths: ["vision", "OCR", "document", "video"],
  },

  // Meta-router (auto-selects best free model for your request)
  "openrouter/free": {
    name: "OpenRouter Free Router",
    params: "Auto",
    context: 131_000,
    strengths: ["auto-select", "tool-calling", "fallback"],
  },
} as const;

export type FreeModelId = keyof typeof FREE_MODELS;

/** Default free model for coding/agentic tasks */
export const DEFAULT_FREE_MODEL: FreeModelId = "nvidia/nemotron-3-ultra-550b-a55b:free";

/** Fast free model for sub-agent tasks */
export const FAST_FREE_MODEL: FreeModelId = "openai/gpt-oss-20b:free";

/** Fallback auto-router */
export const FALLBACK_FREE_MODEL: FreeModelId = "openrouter/free";

/** Get recommended free model for a given use case */
export function recommendFreeModel(useCase: "coding" | "reasoning" | "fast" | "multimodal" | "general"): FreeModelId {
  switch (useCase) {
    case "coding": return "poolside/laguna-m.1:free";
    case "reasoning": return "nvidia/nemotron-3-ultra-550b-a55b:free";
    case "fast": return "openai/gpt-oss-20b:free";
    case "multimodal": return "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
    case "general": return "nvidia/nemotron-3-super-120b-a12b:free";
  }
}
