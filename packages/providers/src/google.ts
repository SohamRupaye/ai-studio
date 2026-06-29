import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export class GoogleProvider implements Provider {
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): Promise<{ text: string; toolCalls: any[]; usage: any }> {
    const body: any = {
      system_instruction: { parts: [{ text: system }] },
      contents: this.formatMessages(messages),
    };
    if (tools?.length) {
      body.tools = [{ function_declarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }

    const res = await fetch(`${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const parts = data.candidates?.[0]?.content?.parts || [];
    let text = "";
    const toolCalls: any[] = [];
    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) toolCalls.push({ id: crypto.randomUUID().slice(0, 8), name: part.functionCall.name, arguments: part.functionCall.args });
    }
    return { text, toolCalls, usage: data.usageMetadata };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      system_instruction: { parts: [{ text: system }] },
      contents: this.formatMessages(messages),
    };
    if (tools?.length) {
      body.tools = [{ function_declarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }

    const res = await fetch(`${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let data: any;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text) yield { type: "text", text: part.text };
          if (part.functionCall) {
            yield { type: "tool_call", id: crypto.randomUUID().slice(0, 8), name: part.functionCall.name, arguments: part.functionCall.args };
          }
        }
      }
    }
  }

  /**
   * GET /v1beta/models?key=... — paginates via pageToken. Model names come
   * back prefixed "models/" and must be stripped; only models that support
   * generateContent are usable for chat.
   */
  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${this.baseUrl}/models`);
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`);
      const data = await res.json() as {
        models: Array<{ name: string; supportedGenerationMethods?: string[] }>;
        nextPageToken?: string;
      };
      for (const m of data.models) {
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes("generateContent")) continue;
        ids.push(m.name.replace(/^models\//, ""));
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    const toolCallNames = new Map<string, string>();
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolCallNames.set(tc.id, tc.name);
        }
      }
    }

    const contents: any[] = [];
    for (const m of messages) {
      if (m.role === "tool_result") {
        const functionName = m.toolCallId ? (toolCallNames.get(m.toolCallId) || m.toolCallId) : "";
        const part = { functionResponse: { name: functionName, response: { result: m.content } } };
        const last = contents[contents.length - 1];
        if (last && last.role === "function") {
          last.parts.push(part);
        } else {
          contents.push({ role: "function", parts: [part] });
        }
      } else if (m.toolCalls) {
        const parts: any[] = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        parts.push(...m.toolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.arguments } })));
        contents.push({ role: "model", parts });
      } else {
        const role = m.role === "assistant" ? "model" : "user";
        const last = contents[contents.length - 1];
        if (last && last.role === role && last.parts.length === 1 && typeof last.parts[0].text === "string") {
          last.parts[0].text += "\n\n" + m.content;
        } else {
          contents.push({ role, parts: [{ text: m.content }] });
        }
      }
    }
    return contents;
  }
}
