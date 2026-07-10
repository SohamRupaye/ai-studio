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

// Vision-capable model families, matched case-insensitively against the model
// id. Deliberately conservative: an unrecognised model returns false, so the
// app blocks the send with an honest "this model can't see images" message
// rather than shipping image parts to a text-only model and getting a 400.
// A false negative just prompts a model switch; a false positive breaks the
// request — so we only list families we're confident carry vision.
const VISION_PATTERNS: RegExp[] = [
  /claude-3/i, /claude-4/i, /claude-(opus|sonnet|haiku)/i, /claude-(fable|mythos)/i,
  /gpt-4o/i, /gpt-4\.1/i, /gpt-4-turbo/i, /gpt-4-vision/i, /chatgpt-4o/i,
  /gpt-5/i, /\bo[134]\b/i, /o1-/i, /o3-/i, /o4-/i,
  /gemini/i,
  // Llama 3.2 is matched only via "vision" — the 1B/3B variants are text-only,
  // and Meta's vision variants all carry it in the id (Llama-3.2-11B-Vision).
  /llava/i, /pixtral/i, /qwen.*-vl/i, /llama.*vision/i,
  /phi-3-vision/i, /phi-4/i, /internvl/i, /minicpm-v/i, /molmo/i,
  /mistral-small-3/i, /grok.*vision/i, /grok-4/i, /glm-4v/i, /step-1v/i,
  /nemotron.*omni/i, /gemma-3/i,
];

/** Whether a model can accept image inputs. Conservative: unknown → false. */
export function supportsVision(model: string): boolean {
  return VISION_PATTERNS.some((re) => re.test(model));
}

// Model families that accept PDFs natively as document/inline_data content.
// Same conservative posture as vision: a false negative means the PDF rides
// as extracted text (today's behavior); a false positive means a 400.
const PDF_INPUT_PATTERNS: RegExp[] = [
  /claude-3/i, /claude-4/i, /claude-(opus|sonnet|haiku)/i, /claude-(fable|mythos)/i,
  /gemini/i,
];

/** Whether a model can read PDFs natively (layout, tables, figures — not just
 * an extracted text layer). Conservative: unknown → false. */
export function supportsPdfInput(model: string): boolean {
  return PDF_INPUT_PATTERNS.some((re) => re.test(model));
}

let encoder: Tiktoken | null = null;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (!encoder) {
    encoder = get_encoding("cl100k_base");
  }
  return encoder.encode(text).length;
}
