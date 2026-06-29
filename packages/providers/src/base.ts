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

export interface ProviderMessage {
  role: "user" | "assistant" | "tool_result";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export type StreamEvent =
  | { type: "text"; text: string }
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
