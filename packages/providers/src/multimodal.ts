import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

/**
 * Multimodal content block for messages
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * Extended ProviderMessage supporting multimodal content
 */
export interface MultimodalMessage extends Omit<ProviderMessage, "content"> {
  content: string | ContentBlock[];
}

/**
 * Convert multimodal messages back to provider format for providers that
 * support vision (OpenAI, Google, Anthropic, OpenRouter)
 */
export function toProviderMessages(messages: MultimodalMessage[]): ProviderMessage[] {
  return messages.map(m => {
    if (typeof m.content === "string") return m as ProviderMessage;
    // For providers that accept content arrays, stringify only text parts
    // Provider adapters handle the array format natively
    const textOnly = m.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map(b => b.text)
      .join("");
    return { ...m, content: textOnly } as ProviderMessage;
  });
}

/** Check if content has images */
export function hasImages(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return false;
  return content.some(b => b.type === "image_url");
}
