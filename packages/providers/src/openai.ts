import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export class OpenAIProvider implements Provider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): Promise<{ text: string; toolCalls: any[]; usage: any }> {
    const body: any = {
      model,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    }));
    return { text: choice.message.content || "", toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

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
        const raw = line.slice(6);
        if (raw === "[DONE]") {
          for (const [, tc] of toolAccum) {
            let args: Record<string, unknown>;
            try { args = JSON.parse(tc.args || "{}"); } catch { args = {}; }
            yield { type: "tool_call", id: tc.id, name: tc.name, arguments: args };
          }
          return;
        }
        let event: any;
        try { event = JSON.parse(raw); } catch { continue; }
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) yield { type: "text", text: delta.content };
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolAccum.has(tc.index)) toolAccum.set(tc.index, { id: tc.id || "", name: "", args: "" });
            const acc = toolAccum.get(tc.index)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
      }
    }
    for (const [, tc] of toolAccum) {
      let args: Record<string, unknown>;
      try { args = JSON.parse(tc.args || "{}"); } catch { args = {}; }
      yield { type: "tool_call", id: tc.id, name: tc.name, arguments: args };
    }
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.toolCalls) {
        return {
          role: "assistant",
          content: null,
          tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
        };
      }
      return { role: m.role, content: m.content };
    });
  }
}
