import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export class AnthropicProvider implements Provider {
  private apiKey: string;
  private baseUrl = "https://api.anthropic.com/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): Promise<{ text: string; toolCalls: any[]; usage: any }> {
    const body: any = {
      model,
      max_tokens: 8192,
      system,
      messages: this.formatMessages(messages),
    };
    if (tools?.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;

    let text = "";
    const toolCalls: any[] = [];
    for (const block of data.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
    }
    return { text, toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      model,
      max_tokens: 8192,
      stream: true,
      system,
      messages: this.formatMessages(messages),
    };
    if (tools?.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") return;
        let event: any;
        try { event = JSON.parse(raw); } catch { continue; }

        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          } else if (event.delta?.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop" && currentToolName) {
          let toolArgs: Record<string, unknown>;
          try { toolArgs = JSON.parse(currentToolInput || "{}"); } catch { toolArgs = {}; }
          yield { type: "tool_call", id: currentToolId, name: currentToolName, arguments: toolArgs };
          currentToolName = "";
        } else if (event.type === "message_delta" && event.usage) {
          yield { type: "usage", usage: event.usage };
        }
      }
    }
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    const formatted: any[] = [];
    for (const m of messages) {
      if (m.role === "tool_result") {
        const last = formatted[formatted.length - 1];
        const block = { type: "tool_result" as const, tool_use_id: m.toolCallId, content: m.content };
        if (last && last.role === "user" && Array.isArray(last.content)) {
          last.content.push(block);
        } else {
          formatted.push({ role: "user", content: [block] });
        }
      } else if (m.toolCalls) {
        const content: any[] = [];
        if (m.content) {
          content.push({ type: "text", text: m.content });
        }
        content.push(...m.toolCalls.map(tc => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.arguments })));
        formatted.push({ role: "assistant", content });
      } else {
        const role = m.role === "assistant" ? "assistant" : "user";
        const last = formatted[formatted.length - 1];
        if (last && last.role === role && typeof last.content === "string") {
          last.content += "\n\n" + m.content;
        } else {
          formatted.push({ role, content: m.content });
        }
      }
    }
    return formatted;
  }
}
