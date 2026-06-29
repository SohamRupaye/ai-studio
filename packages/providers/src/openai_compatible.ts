/**
 * OpenAI-Compatible Provider Factory
 * Most providers (Groq, Mistral, DeepInfra, Cerebras, TogetherAI, Perplexity, etc.)
 * use the same OpenAI chat completions API with different base URLs.
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  name?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
}

export class OpenAICompatibleProvider implements Provider {
  private config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
  }

  private get headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const body: any = {
      model: model || this.config.defaultModel,
      messages: [{ role: "system", content: system }, ...this.fmt(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`${this.config.name ?? "Provider"} ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    if (!data.choices?.length) throw new Error(`${this.config.name ?? "Provider"} returned no choices: ${JSON.stringify(data.error ?? data)}`);
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    }));
    return { text: choice.message.content || "", toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      model: model || this.config.defaultModel, stream: true,
      messages: [{ role: "system", content: system }, ...this.fmt(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`${this.config.name ?? "Provider"} ${res.status}: ${await res.text()}`);

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
            try { yield { type: "tool_call", id: tc.id, name: tc.name, arguments: JSON.parse(tc.args) }; } catch { yield { type: "tool_call", id: tc.id, name: tc.name, arguments: {} }; }
          }
          return;
        }
        let chunk: any;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new Error(`${this.config.name ?? "Provider"} stream error${chunk.error.code ? ` ${chunk.error.code}` : ""}: ${chunk.error.message || JSON.stringify(chunk.error)}`);
        }
        try {
          const delta = chunk.choices?.[0]?.delta;
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
    for (const [, tc] of toolAccum) {
      try { yield { type: "tool_call", id: tc.id, name: tc.name, arguments: JSON.parse(tc.args) }; } catch {}
    }
  }

  private fmt(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      if (m.toolCalls?.length) return { role: "assistant", content: null, tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) };
      return { role: m.role, content: m.content };
    });
  }

  /**
   * GET {baseUrl}/models — most OpenAI-compatible providers return
   * {data: [{id, ...}]}. Cohere is the one exception in this family: its
   * models list lives at a sibling /v1/models (not /v2) and returns
   * {models: [{name, ...}]} instead. Both shapes are handled here.
   */
  async listModels(): Promise<string[]> {
    const url = this.config.name === "Cohere"
      ? this.config.baseUrl.replace(/\/v2$/, "/v1") + "/models"
      : `${this.config.baseUrl}/models`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`${this.config.name ?? "Provider"} ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    if (Array.isArray(data.data)) return data.data.map((m: any) => m.id);
    if (Array.isArray(data.models)) return data.models.map((m: any) => m.name ?? m.id);
    return [];
  }
}

// --- Pre-configured provider factories ---

export function createGroqProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.groq.com/openai/v1", name: "Groq" });
}

export function createMistralProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.mistral.ai/v1", name: "Mistral" });
}

export function createDeepInfraProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.deepinfra.com/v1/openai", name: "DeepInfra" });
}

export function createCerebrasProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.cerebras.ai/v1", name: "Cerebras" });
}

export function createTogetherAIProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.together.xyz/v1", name: "TogetherAI" });
}

export function createPerplexityProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.perplexity.ai", name: "Perplexity" });
}

export function createCohereProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.cohere.com/v2", name: "Cohere" });
}

export function createXAIProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.x.ai/v1", name: "xAI" });
}

export function createNVIDIAProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://integrate.api.nvidia.com/v1", name: "NVIDIA" });
}

export function createFireworksProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.fireworks.ai/inference/v1", name: "Fireworks" });
}

export function createDeepSeekProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://api.deepseek.com/v1", name: "DeepSeek" });
}

export function createAlibabaProvider(apiKey: string) {
  return new OpenAICompatibleProvider({ apiKey, baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", name: "Alibaba" });
}
