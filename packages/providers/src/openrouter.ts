/**
 * OpenRouter Provider - Access 100+ models through a single API
 * Supports: Claude, GPT-4, Gemini, Mistral, Llama, DeepSeek, etc.
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export class OpenRouterProvider implements Provider {
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1";
  private siteUrl?: string;
  private siteName?: string;

  constructor(apiKey: string, opts?: { siteUrl?: string; siteName?: string }) {
    this.apiKey = apiKey;
    this.siteUrl = opts?.siteUrl;
    this.siteName = opts?.siteName;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    if (this.siteUrl) h["HTTP-Referer"] = this.siteUrl;
    if (this.siteName) h["X-Title"] = this.siteName;
    return h;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const body: any = {
      model,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    }));
    return { text: choice.message.content || "", toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      model, stream: true,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);

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
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield { type: "text", text: delta.content };
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (tc.id) toolAccum.set(idx, { id: tc.id, name: tc.function?.name ?? "", args: "" });
              const entry = toolAccum.get(idx);
              if (entry && tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
          if (chunk.usage) yield { type: "usage", usage: chunk.usage };
        } catch {}
      }
    }
    for (const [, tc] of toolAccum) {
      try {
        yield { type: "tool_call", id: tc.id, name: tc.name, arguments: JSON.parse(tc.args) };
      } catch {
        yield { type: "tool_call", id: tc.id, name: tc.name, arguments: {} };
      }
    }
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      const msg: any = { role: m.role, content: m.content };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
        msg.content = msg.content || null;
      }
      return msg;
    });
  }
}
