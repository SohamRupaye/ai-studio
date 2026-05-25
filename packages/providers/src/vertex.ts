/**
 * Google Vertex AI Provider - GCP-native access to Gemini + Claude via Vertex
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";

export interface VertexAIConfig {
  projectId: string;
  region?: string;
  accessToken: string; // OAuth2 access token (from gcloud auth or service account)
}

export class VertexAIProvider implements Provider {
  private config: VertexAIConfig;
  private region: string;

  constructor(config: VertexAIConfig) {
    this.config = config;
    this.region = config.region ?? "us-central1";
  }

  private endpoint(model: string, stream = false): string {
    const action = stream ? "streamGenerateContent" : "generateContent";
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.config.projectId}/locations/${this.region}/publishers/google/models/${model}:${action}`;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const body = this.buildBody(messages, system, tools);
    const res = await fetch(this.endpoint(model), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.accessToken}` },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`VertexAI ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const candidate = data.candidates?.[0];
    let text = "";
    const toolCalls: any[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall) toolCalls.push({ id: crypto.randomUUID(), name: part.functionCall.name, arguments: part.functionCall.args });
    }
    return { text, toolCalls, usage: data.usageMetadata };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body = this.buildBody(messages, system, tools);
    const url = `${this.endpoint(model, true)}?alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.accessToken}` },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`VertexAI ${res.status}: ${await res.text()}`);

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
        try {
          const data = JSON.parse(line.slice(6));
          for (const part of data.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) yield { type: "text", text: part.text };
            if (part.functionCall) yield { type: "tool_call", id: crypto.randomUUID(), name: part.functionCall.name, arguments: part.functionCall.args };
          }
          if (data.usageMetadata) yield { type: "usage", usage: data.usageMetadata };
        } catch {}
      }
    }
  }

  private buildBody(messages: ProviderMessage[], system: string, tools?: any[]): any {
    const body: any = {
      systemInstruction: { parts: [{ text: system }] },
      contents: this.formatMessages(messages),
    };
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    return body;
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") {
        return { role: "user", parts: [{ functionResponse: { name: m.toolCallId ?? "", response: { output: m.content } } }] };
      }
      if (m.toolCalls?.length) {
        return { role: "model", parts: m.toolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.arguments } })) };
      }
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
    });
  }
}
