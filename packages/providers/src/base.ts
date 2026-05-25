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
}
