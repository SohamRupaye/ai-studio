/**
 * OpenRouter Provider - Access 100+ models through a single API
 * Supports: Claude, GPT-4, Gemini, Mistral, Llama, DeepSeek, etc.
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { toOpenAIContent } from "./base.js";
import { ProviderRateLimitError } from "./base.js";
import { getConfig } from "./config.js";

/**
 * Turn an OpenRouter `{error: {message, code, metadata: {...}}}` body into a
 * clean, user-facing message instead of surfacing the raw JSON blob — this
 * is what free-tier rate limits (and other upstream failures) look like:
 * https://openrouter.ai/docs/api-reference/errors
 */
function buildOpenRouterError(model: string, status: number | undefined, err: any): Error {
  const meta = err?.metadata ?? {};
  const code = err?.code ?? status;
  const provider = typeof meta.provider_name === "string" ? meta.provider_name : undefined;
  const providerSuffix = provider ? ` via ${provider}` : "";

  if (code === 429) {
    const retryAfterSeconds = typeof meta.retry_after_seconds === "number" ? Math.ceil(meta.retry_after_seconds) : undefined;
    const retryHint = retryAfterSeconds ? `Retry in ~${retryAfterSeconds}s` : "Retry shortly";
    const message = `${model} is rate-limited${providerSuffix} on OpenRouter's free tier. ${retryHint}, or add your own key at openrouter.ai/settings/integrations for higher limits.`;
    return new ProviderRateLimitError(message, { retryAfterSeconds, provider });
  }

  return new Error(`${model}${providerSuffix}: ${err?.message ?? "request failed"}${code ? ` (${code})` : ""}`);
}

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
      max_tokens: getConfig().maxTokens,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let parsedErr: any;
      try { parsedErr = JSON.parse(text)?.error; } catch { /* not JSON */ }
      throw parsedErr ? buildOpenRouterError(model, res.status, parsedErr) : new Error(`OpenRouter ${res.status}: ${text}`);
    }
    const data = await res.json() as any;
    if (!data.choices?.length) throw new Error(`OpenRouter returned no choices: ${JSON.stringify(data.error ?? data)}`);
    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc: any) => ({
      id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    }));
    return { text: choice.message.content || "", toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body: any = {
      model, stream: true,
      max_tokens: getConfig().maxTokens,
      messages: [{ role: "system", content: system }, ...this.formatMessages(messages)],
    };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body), signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let parsedErr: any;
      try { parsedErr = JSON.parse(text)?.error; } catch { /* not JSON */ }
      throw parsedErr ? buildOpenRouterError(model, res.status, parsedErr) : new Error(`OpenRouter ${res.status}: ${text}`);
    }

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
        let chunk: any;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        // OpenRouter can emit a mid-stream error frame (no `choices`) on a
        // 200 response, e.g. when a free-tier upstream host rate-limits or
        // drops the request. Surface it instead of silently ending the
        // stream with zero tokens — the caller's retry/error handling needs
        // an actual exception to act on.
        if (chunk.error) {
          throw buildOpenRouterError(model, undefined, chunk.error);
        }
        try {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield { type: "text", text: delta.content };
          // OpenRouter reasoning models stream `reasoning` (some upstreams
          // proxy DeepSeek's `reasoning_content`).
          const thinking = delta.reasoning ?? delta.reasoning_content;
          if (typeof thinking === "string" && thinking) yield { type: "thinking", text: thinking };
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
      const msg: any = { role: m.role, content: toOpenAIContent(m.content) };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
        msg.content = msg.content || null;
      }
      return msg;
    });
  }

  /**
   * GET /v1/models — returns OpenRouter's full live catalog. Filtered to
   * free-tier models (pricing.prompt === "0" && pricing.completion === "0")
   * since that's what AI Studio's OpenRouter integration is scoped to; the
   * static FREE_MODELS list is only a fallback if this fetch fails.
   */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json() as { data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    return data.data
      .filter(m => m.pricing?.prompt === "0" && m.pricing?.completion === "0")
      .map(m => m.id);
  }
}
