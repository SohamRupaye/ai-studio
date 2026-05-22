import { get_encoding, type Tiktoken } from "tiktoken";

export const MODEL_LIMITS: Record<string, number> = {
  claude: 190_000,
  gemini: 900_000,
  "gpt-5": 120_000,
  "gpt-4o": 120_000,
  "gpt-4-turbo": 120_000,
  o1: 120_000,
  o3: 190_000,
  o4: 190_000,
};

export function getContextLimit(model: string): number {
  for (const [prefix, limit] of Object.entries(MODEL_LIMITS)) {
    if (model.startsWith(prefix)) return limit;
  }
  return 120_000;
}

let encoder: Tiktoken | null = null;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (!encoder) {
    encoder = get_encoding("cl100k_base");
  }
  return encoder.encode(text).length;
}
