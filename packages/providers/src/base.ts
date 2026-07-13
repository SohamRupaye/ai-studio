/**
 * Thrown for a 429 from a provider so callers (the desktop app's chat:send
 * handler) can show a clean, actionable toast instead of dumping the raw
 * upstream error body. `retryAfterSeconds` and `provider`, when present,
 * come straight from the upstream response and let the UI show a countdown
 * / keep the toast visible for at least that long.
 */
export class ProviderRateLimitError extends Error {
  retryAfterSeconds?: number;
  provider?: string;

  constructor(message: string, opts?: { retryAfterSeconds?: number; provider?: string }) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.provider = opts?.provider;
  }
}

/**
 * Provider-neutral message content parts. A message is either a plain string
 * (the common case) or an ordered list of blocks mixing text, images, and
 * documents. Each adapter translates blocks into its own wire format
 * (Anthropic base64 source, OpenAI `image_url` data URL, Google `inline_data`).
 * `data` is raw base64 with no `data:` prefix; `mediaType` is the mime type.
 * Document blocks (PDFs sent natively, preserving layout/tables the extracted
 * text loses) only reach providers whose models accept them — the app gates on
 * model capability before building one; adapters for wire formats without
 * document support degrade them to a text placeholder.
 */
export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; mediaType: string; data: string };
export type DocumentContent = { type: "document"; mediaType: string; data: string; title?: string };
export type ContentBlock = TextContent | ImageContent | DocumentContent;

export interface ProviderMessage {
  role: "user" | "assistant" | "tool_result";
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

/** Flatten message content to plain text (images/documents become
 * placeholders). Used by adapters for text-only models and by anywhere that
 * needs a string form. */
export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image]" : `[document${b.title ? `: ${b.title}` : ""}]`))
    .join("");
}

/** The image blocks in a message's content, in order (empty for string content). */
export function imageBlocks(content: string | ContentBlock[]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

// ── Per-wire-format content converters ───────────────────────────────────────
// Each maps our neutral content into one provider family's shape. String
// content passes through unchanged so text-only turns are untouched.

/** Placeholder for a document block on a wire format without document support.
 * Only reached if the capability gate is wrong — degrade legibly, don't 400. */
function documentFallbackText(b: DocumentContent): string {
  return `[Attached document${b.title ? `: ${b.title}` : ""} — not viewable on this model.]`;
}

/** OpenAI chat-completions: string, or an array of text / image_url parts.
 * Document blocks degrade to a text placeholder (file parts exist on some
 * OpenAI models but not across the many OpenAI-compatible hosts sharing this
 * converter, so the safe common denominator is text). */
export function toOpenAIContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : b.type === "image"
        ? { type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } }
        : { type: "text", text: documentFallbackText(b) },
  );
}

/** Anthropic messages: string, or an array of text / image / document
 * (base64 source) blocks. */
export function toAnthropicContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : b.type === "image"
        ? { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } }
        : {
            type: "document",
            source: { type: "base64", media_type: b.mediaType, data: b.data },
            ...(b.title ? { title: b.title } : {}),
          },
  );
}

/** Google Gemini: an array of text / inline_data parts (always an array).
 * Images and documents both ride as inline_data — Gemini reads PDFs natively. */
export function toGoogleParts(content: string | ContentBlock[]): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((b) =>
    b.type === "text" ? { text: b.text } : { inline_data: { mime_type: b.mediaType, data: b.data } },
  );
}

/** OpenAI Responses API (Codex): string, or input_text / input_image parts.
 * Images only ride user turns in our flow, so text maps to input_text.
 * Documents degrade to a text placeholder. */
export function toResponsesContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "text"
      ? { type: "input_text", text: b.text }
      : b.type === "image"
        ? { type: "input_image", image_url: `data:${b.mediaType};base64,${b.data}` }
        : { type: "input_text", text: documentFallbackText(b) },
  );
}

/** Map an image mime type to a Bedrock Converse image format token. */
function bedrockImageFormat(mediaType: string): string {
  const m = mediaType.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpeg";
}

/** Converse document names allow only alphanumerics, whitespace, hyphens,
 * parens, and brackets — and must be non-empty. */
function bedrockDocumentName(title?: string): string {
  const clean = (title ?? "").replace(/[^a-zA-Z0-9\s\-()[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || "document";
}

/** Bedrock Converse: an array of text / image / document blocks (always an
 * array; `bytes` is base64 in the JSON request). */
export function toBedrockContent(content: string | ContentBlock[]): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((b) =>
    b.type === "text"
      ? { text: b.text }
      : b.type === "image"
        ? { image: { format: bedrockImageFormat(b.mediaType), source: { bytes: b.data } } }
        : { document: { format: "pdf", name: bedrockDocumentName(b.title), source: { bytes: b.data } } },
  );
}

export type StreamEvent =
  | { type: "text"; text: string }
  /** Model reasoning/thinking, streamed wherever the wire format carries it
   * (Anthropic thinking_delta, chat-completions reasoning_content/reasoning,
   * Gemini thought parts, Bedrock reasoningContent, Codex reasoning summary).
   * User-facing visibility only — never re-sent to the model. */
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_call_streaming"; name: string; bytesReceived: number }
  | { type: "usage"; usage: any };

export interface Provider {
  call(
    model: string,
    messages: ProviderMessage[],
    system: string,
    tools?: any[],
    signal?: AbortSignal,
  ): Promise<{ text: string; toolCalls: any[]; usage: any }>;

  stream(
    model: string,
    messages: ProviderMessage[],
    system: string,
    tools?: any[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;

  /**
   * Fetch the live list of available model IDs from the provider's API.
   * Optional — providers without a public models endpoint (e.g. Codex OAuth)
   * omit this, and callers should fall back to a hardcoded list on failure.
   */
  listModels?(): Promise<string[]>;
}
