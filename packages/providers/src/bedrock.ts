/**
 * Amazon Bedrock Provider - AWS-native LLM access
 * Uses the Bedrock converse API with AWS Sig V4 auth
 */
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { toBedrockContent } from "./base.js";
import { createHmac, createHash } from "crypto";

export interface BedrockConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class BedrockProvider implements Provider {
  private config: BedrockConfig;

  constructor(config: BedrockConfig) {
    this.config = config;
  }

  private get endpoint(): string {
    return `https://bedrock-runtime.${this.config.region}.amazonaws.com`;
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal) {
    const body = this.buildBody(messages, system, tools);
    const url = `${this.endpoint}/model/${encodeURIComponent(model)}/converse`;
    const res = await this.signedFetch(url, body, signal);
    if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const output = data.output?.message;
    let text = "";
    const toolCalls: any[] = [];
    for (const block of output?.content ?? []) {
      if (block.text) text += block.text;
      if (block.toolUse) toolCalls.push({ id: block.toolUse.toolUseId, name: block.toolUse.name, arguments: block.toolUse.input });
    }
    return { text, toolCalls, usage: data.usage };
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const body = this.buildBody(messages, system, tools);
    const url = `${this.endpoint}/model/${encodeURIComponent(model)}/converse-stream`;
    const res = await this.signedFetch(url, body, signal);
    if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Bedrock streams as event-stream with JSON lines
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.contentBlockDelta?.delta?.text) {
            yield { type: "text", text: event.contentBlockDelta.delta.text };
          }
          if (event.contentBlockDelta?.delta?.reasoningContent?.text) {
            yield { type: "thinking", text: event.contentBlockDelta.delta.reasoningContent.text };
          }
          if (event.contentBlockDelta?.delta?.toolUse) {
            const tu = event.contentBlockDelta.delta.toolUse;
            yield { type: "tool_call", id: tu.toolUseId ?? "", name: tu.name ?? "", arguments: tu.input ?? {} };
          }
          if (event.metadata?.usage) {
            yield { type: "usage", usage: event.metadata.usage };
          }
        } catch {}
      }
    }
  }

  private buildBody(messages: ProviderMessage[], system: string, tools?: any[]): any {
    const body: any = {
      system: [{ text: system }],
      messages: this.formatMessages(messages),
    };
    if (tools?.length) {
      body.toolConfig = {
        tools: tools.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters } } })),
      };
    }
    return body;
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    return messages.map(m => {
      if (m.role === "tool_result") {
        return { role: "user", content: [{ toolResult: { toolUseId: m.toolCallId, content: [{ text: m.content }] } }] };
      }
      if (m.toolCalls?.length) {
        return { role: "assistant", content: m.toolCalls.map(tc => ({ toolUse: { toolUseId: tc.id, name: tc.name, input: tc.arguments } })) };
      }
      const role = m.role === "assistant" ? "assistant" : "user";
      return { role, content: toBedrockContent(m.content) };
    });
  }

  private async signedFetch(url: string, body: any, signal?: AbortSignal): Promise<Response> {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    const parsedUrl = new URL(url);
    const payload = JSON.stringify(body);
    const payloadHash = createHash("sha256").update(payload).digest("hex");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      host: parsedUrl.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };
    if (this.config.sessionToken) headers["x-amz-security-token"] = this.config.sessionToken;

    const signedHeaderKeys = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join("");
    const canonicalRequest = [
      "POST", parsedUrl.pathname, parsedUrl.search.slice(1),
      canonicalHeaders, signedHeaderKeys, payloadHash,
    ].join("\n");

    const credScope = `${dateStamp}/${this.config.region}/bedrock/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope,
      createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

    const sign = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest();
    const kDate = sign(Buffer.from("AWS4" + this.config.secretAccessKey), dateStamp);
    const kRegion = sign(kDate, this.config.region);
    const kService = sign(kRegion, "bedrock");
    const kSigning = sign(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credScope}, SignedHeaders=${signedHeaderKeys}, Signature=${signature}`;

    return fetch(url, { method: "POST", headers, body: payload, signal });
  }
}
