/**
 * Azure OpenAI Provider - Uses Azure-specific endpoint format and API key header
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { OpenAICompatibleProvider } from "./openai_compatible.js";

export interface AzureConfig {
  apiKey: string;
  endpoint: string; // e.g. https://your-resource.openai.azure.com
  apiVersion?: string;
  deployment?: string;
}

export class AzureOpenAIProvider implements Provider {
  private inner: OpenAICompatibleProvider;
  private endpoint: string;
  private apiVersion: string;
  private deployment?: string;
  private apiKey: string;

  constructor(config: AzureConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.apiVersion = config.apiVersion ?? "2024-08-01-preview";
    this.deployment = config.deployment;
    this.apiKey = config.apiKey;
    // Azure uses api-key header instead of Bearer token
    this.inner = new OpenAICompatibleProvider({
      apiKey: "",
      baseUrl: this.endpoint,
      name: "Azure",
      headers: { "api-key": config.apiKey },
    });
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const deployment = this.deployment ?? model;
    const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;
    const body: any = {
      messages: [{ role: "system", content: system }, ...this.fmt(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    }));
    return { text: choice.message.content || "", toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const deployment = this.deployment ?? model;
    const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;
    const body: any = {
      stream: true,
      messages: [{ role: "system", content: system }, ...this.fmt(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const toolAccum = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") {
          for (const [, tc] of toolAccum) {
            try { yield { type: "tool_call", id: tc.id, name: tc.name, arguments: JSON.parse(tc.args) }; } catch {}
          }
          return;
        }
        try {
          const delta = JSON.parse(raw).choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield { type: "text", text: delta.content };
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolAccum.has(idx)) toolAccum.set(idx, { id: "", name: "", args: "" });
              const a = toolAccum.get(idx)!;
              if (tc.id) a.id = tc.id;
              if (tc.function?.name) a.name = tc.function.name;
              if (tc.function?.arguments) a.args += tc.function.arguments;
            }
          }
        } catch {}
      }
    }
  }

  private fmt(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      if (m.toolCalls?.length) return { role: "assistant", content: null, tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) };
      return { role: m.role, content: m.content };
    });
  }
}
