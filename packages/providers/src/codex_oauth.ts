/**
 * CodexOAuth provider — GPT-5.x via OAuth PKCE (no API key needed).
 * Tokens cached at ~/.ai-studio/auth.json, auto-refreshed.
 */

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Provider, ProviderMessage, StreamEvent } from "./base.js";
import { toResponsesContent } from "./base.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
// Undocumented catalogue endpoint (the Codex CLI refreshes its model list
// from here) — availability depends on subscription tier. listModels() fails
// soft: the router keeps its hardcoded fallback list when this breaks.
const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models";
const OAUTH_PORT = 1455;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/auth/callback`;

const AUTH_DIR = join(homedir(), ".ai-studio");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

interface AuthData {
  access: string;
  refresh: string;
  expires: number;
  account_id?: string;
  email?: string;
}

export interface CodexAccountStatus {
  connected: boolean;
  accountId?: string;
  email?: string;
}

export class CodexOAuthProvider implements Provider {
  private auth: AuthData | null;
  private refreshLock: Promise<AuthData> | null = null;

  constructor() {
    this.auth = this.loadAuth();
  }

  isAvailable(): boolean {
    return this.auth !== null;
  }

  /** Current signed-in account, if any — used by the UI to show who's connected. */
  getStatus(): CodexAccountStatus {
    if (!this.auth) return { connected: false };
    return { connected: true, accountId: this.auth.account_id, email: this.auth.email };
  }

  /**
   * Clear cached tokens (both in-memory and on disk). Does not revoke the
   * token with the issuer — ChatGPT sessions don't support programmatic
   * revocation — but the app forgets it immediately, and the next call
   * triggers a fresh `login()` (which lets the user pick a different
   * account in the browser).
   */
  logout(): void {
    this.auth = null;
    if (existsSync(AUTH_FILE)) {
      try { unlinkSync(AUTH_FILE); } catch { /* best-effort */ }
    }
  }

  /** Force a fresh browser login, replacing any existing session. Used for "switch account". */
  async switchAccount(): Promise<AuthData> {
    this.logout();
    return this.login();
  }

  async call(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): Promise<{ text: string; toolCalls: any[]; usage: any }> {
    let text = "";
    const toolCalls: any[] = [];
    let usage: any = {};

    for await (const event of this.stream(model, messages, system, tools, signal)) {
      if (event.type === "text") text += event.text;
      else if (event.type === "tool_call") toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
      else if (event.type === "usage") usage = event.usage;
    }
    return { text, toolCalls, usage };
  }

  /**
   * Live model catalogue for the signed-in account (tier-dependent — Pro
   * accounts see models Plus accounts don't). The endpoint is undocumented,
   * so parsing is defensive and every failure path throws: the Router treats
   * a throw as "keep the hardcoded fallback list", never zero models.
   */
  async listModels(): Promise<string[]> {
    // Deliberately NOT ensureAuth(): that falls back to an interactive
    // browser login, and this runs from the background model refresh at
    // startup. Signed out → throw → the router keeps the fallback list.
    if (!this.auth) throw new Error("Codex not connected");
    const auth =
      this.auth.expires < Date.now() + 60_000 ? await this.refresh() : this.auth;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${auth.access}`,
      "User-Agent": "opencode/latest",
      "originator": "opencode",
    };
    if (auth.account_id) headers["ChatGPT-Account-Id"] = auth.account_id;

    let res = await fetch(CODEX_MODELS_ENDPOINT, { headers });
    if (res.status === 401) {
      const refreshed = await this.refresh();
      headers["Authorization"] = `Bearer ${refreshed.access}`;
      res = await fetch(CODEX_MODELS_ENDPOINT, { headers });
    }
    if (!res.ok) throw new Error(`Codex models ${res.status}`);

    const payload: any = await res.json();
    // Accept the shapes this backend family has been seen to use:
    // { models: [...] } | { data: [...] } | bare array; items either strings
    // or objects carrying slug/id/model/name.
    const list: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
    const ids = [
      ...new Set(
        list
          .map((item) =>
            typeof item === "string" ? item : (item?.slug ?? item?.id ?? item?.model ?? item?.name),
          )
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (!ids.length) throw new Error("Codex models: empty/unrecognised payload");
    return ids;
  }

  async *stream(model: string, messages: ProviderMessage[], system: string, tools?: any[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const auth = await this.ensureAuth();
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${auth.access}`,
      "Content-Type": "application/json",
      "User-Agent": "opencode/latest",
      "originator": "opencode",
    };
    if (auth.account_id) headers["ChatGPT-Account-Id"] = auth.account_id;

    const input = this.formatMessages(messages);
    // No output cap: the codex backend-api rejects max_output_tokens
    // ("Unsupported parameter") — limits are enforced server-side.
    // reasoning.summary makes the backend stream reasoning-summary deltas
    // (all codex models are gpt-5.x reasoning models; the Codex CLI sends
    // this too). Retried without on 400, in case a model rejects it.
    const body: any = { model, instructions: system, input, stream: true, store: false, reasoning: { summary: "auto" } };

    if (tools?.length) {
      body.tools = tools.map(t => ({ type: "function", name: t.name, description: t.description || "", parameters: t.parameters || {} }));
    }

    let res = await fetch(CODEX_ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.status === 401) {
      const refreshed = await this.refresh();
      headers["Authorization"] = `Bearer ${refreshed.access}`;
      res = await fetch(CODEX_ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal });
    }
    if (res.status === 400 && body.reasoning) {
      delete body.reasoning;
      res = await fetch(CODEX_ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal });
    }
    if (!res.ok) throw new Error(`Codex ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const currentFC = new Map<string, { id: string; name: string; args: string }>();

    const abortableRead = () => {
      if (signal?.aborted) return Promise.resolve({ done: true as const, value: undefined });
      if (!signal) return reader.read();
      return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const onAbort = () => { reader.cancel(); resolve({ done: true, value: undefined }); };
        signal.addEventListener("abort", onAbort, { once: true });
        reader.read().then(result => {
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        }).catch(reject);
      });
    };

    while (true) {
      if (signal?.aborted) { reader.cancel(); return; }
      const { done, value } = await abortableRead();
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
        const etype = event.type || "";

        if (etype === "response.output_text.delta") {
          const delta = event.delta || "";
          if (delta) yield { type: "text", text: delta };
        } else if (etype === "response.reasoning_summary_text.delta" || etype === "response.reasoning_text.delta") {
          const delta = event.delta || "";
          if (delta) yield { type: "thinking", text: delta };
        } else if (etype === "response.reasoning_summary_part.added") {
          // Parts arrive as separate summary paragraphs — keep them readable.
          yield { type: "thinking", text: "\n\n" };
        } else if (etype === "response.completed") {
          const u = event.response?.usage || {};
          yield { type: "usage", usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 } };
        } else if (etype === "response.function_call_arguments.start" || etype === "response.output_item.added") {
          const item = event.item || event;
          const callId = item.call_id || item.item_id || event.item_id || "";
          const name = item.name || event.name || "";
          if (callId) currentFC.set(callId, { id: callId, name, args: "" });
        } else if (etype === "response.function_call_arguments.delta") {
          const callId = event.item_id || event.call_id || "";
          const fc = currentFC.get(callId);
          if (fc) {
            fc.args += event.delta || "";
            yield { type: "tool_call_streaming", name: fc.name, bytesReceived: fc.args.length };
          }
        } else if (etype === "response.function_call_arguments.done" || etype === "response.output_item.done") {
          const item = event.item || {};
          const callId = event.item_id || event.call_id || item.call_id || item.id || "";
          const fc = currentFC.get(callId);
          if (fc) {
            currentFC.delete(callId);
            const argsStr = fc.args || item.arguments || "{}";
            let args: Record<string, unknown>;
            try { args = JSON.parse(argsStr); } catch { args = { raw: argsStr }; }
            const name = fc.name || item.name || "";
            if (name) yield { type: "tool_call", id: fc.id, name, arguments: args };
          } else if (item.type === "function_call") {
            let args: Record<string, unknown>;
            try { args = JSON.parse(item.arguments || "{}"); } catch { args = {}; }
            yield { type: "tool_call", id: callId, name: item.name || "", arguments: args };
          }
        }
      }
    }
  }

  async login(): Promise<AuthData> {
    const { verifier, challenge } = generatePKCE();
    const state = randomBytes(24).toString("base64url");
    const authUrl = buildAuthUrl(challenge, state);

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${OAUTH_PORT}`);
        if (url.pathname !== "/auth/callback") { res.writeHead(404); res.end(); return; }

        const code = url.searchParams.get("code");
        const gotState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error || !code || gotState !== state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h2>Login failed. Check terminal.</h2>");
          server.close();
          reject(new Error(`OAuth failed: ${error || "bad state"}`));
          return;
        }

        exchangeCode(code, verifier).then(tokens => {
          const accountId = parseJwtAccountId(tokens.access_token) || parseJwtAccountId(tokens.id_token || "");
          const email = parseJwtEmail(tokens.id_token || "") || parseJwtEmail(tokens.access_token);
          const auth: AuthData = {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + (tokens.expires_in || 3600) * 1000,
            account_id: accountId || undefined,
            email: email || undefined,
          };
          this.saveAuth(auth);
          this.auth = auth;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h2>Login successful! Close this tab.</h2>");
          server.close();
          resolve(auth);
        }).catch(e => {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<h2>Token exchange failed.</h2>");
          server.close();
          reject(e);
        });
      });

      server.listen(OAUTH_PORT, () => {
        console.log(`\n[codex_oauth] Opening browser for login...`);
        console.log(`[codex_oauth] If browser does not open:\n  ${authUrl}\n`);
        import("node:child_process").then(({ execFile }) => {
          if (process.platform === "darwin") execFile("open", [authUrl]);
          else if (process.platform === "win32") execFile("cmd", ["/c", "start", "", authUrl]);
          else execFile("xdg-open", [authUrl]);
        });
      });

      setTimeout(() => { server.close(); reject(new Error("OAuth login timed out (120s)")); }, 120_000);
    });
  }

  private async ensureAuth(): Promise<AuthData> {
    if (!this.auth) return this.login();
    if (this.auth.expires < Date.now() + 60_000) {
      // Mutex: if a refresh is already in flight, wait for it
      if (this.refreshLock) return this.refreshLock;
      this.refreshLock = this.refresh().finally(() => { this.refreshLock = null; });
      try { return await this.refreshLock; } catch { return this.login(); }
    }
    return this.auth;
  }

  private async refresh(): Promise<AuthData> {
    if (!this.auth?.refresh) throw new Error("No refresh token");
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.auth.refresh, client_id: CLIENT_ID }),
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const tokens = await res.json() as any;
    this.auth.access = tokens.access_token;
    this.auth.refresh = tokens.refresh_token;
    this.auth.expires = Date.now() + (tokens.expires_in || 3600) * 1000;
    this.saveAuth(this.auth);
    return this.auth;
  }

  private saveAuth(auth: AuthData) {
    mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  }

  private loadAuth(): AuthData | null {
    if (!existsSync(AUTH_FILE)) return null;
    try { return JSON.parse(readFileSync(AUTH_FILE, "utf-8")); } catch { return null; }
  }

  private formatMessages(messages: ProviderMessage[]): any[] {
    const input: any[] = [];
    for (const m of messages) {
      if (m.role === "tool_result") {
        input.push({ type: "function_call_output", call_id: m.toolCallId || "", output: m.content });
      } else if (m.toolCalls) {
        if (m.content) input.push({ role: "assistant", content: m.content });
        for (const tc of m.toolCalls) {
          input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
        }
      } else {
        input.push({ role: m.role === "assistant" ? "assistant" : "user", content: toResponsesContent(m.content) });
      }
    }
    return input;
  }
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function buildAuthUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  });
  return `${ISSUER}/oauth/authorize?${params}`;
}

async function exchangeCode(code: string, verifier: string): Promise<any> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return res.json();
}

function parseJwtAccountId(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    return payload.chatgpt_account_id
      || payload["https://api.openai.com/auth"]?.chatgpt_account_id
      || payload.organizations?.[0]?.id
      || null;
  } catch { return null; }
}

function parseJwtEmail(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    return payload.email || payload["https://api.openai.com/profile"]?.email || null;
  } catch { return null; }
}
