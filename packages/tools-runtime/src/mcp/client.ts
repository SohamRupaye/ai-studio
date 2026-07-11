/**
 * MCP Client - Production-grade multi-transport MCP client
 * Supports: stdio, SSE, streamable HTTP with OAuth, reconnection, tool namespacing
 */
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  MCPServerConfig,
  MCPStatus,
  MCPToolDef,
  MCPToolResult,
  MCPResource,
} from "./types";
import { MCPAuth } from "./auth";
import { startAuthFlow, refreshTokens, type AuthFlowHandle } from "./oauth";

const DEFAULT_TIMEOUT = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private status: MCPStatus = { status: "disabled" };
  private tools: MCPToolDef[] = [];
  private resources: MCPResource[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private sseReader: ReadableStreamDefaultReader | null = null;
  private auth: MCPAuth;
  private serverCapabilities: Record<string, unknown> = {};
  /** Streamable HTTP session id, captured from the initialize response. */
  private sessionId: string | null = null;
  /** Protocol version negotiated at initialize — echoed on later requests. */
  private negotiatedVersion: string | null = null;
  /** WWW-Authenticate challenge from the most recent 401 — feeds discovery. */
  private lastAuthChallenge: string | undefined;

  get authChallenge(): string | undefined {
    return this.lastAuthChallenge;
  }

  /** `auth` is shared with the owning manager so token writes are visible
   * everywhere immediately (each MCPAuth caches its file after first load). */
  constructor(config: MCPServerConfig, auth: MCPAuth = new MCPAuth()) {
    super();
    this.config = config;
    this.auth = auth;
  }

  get name(): string {
    return this.config.name;
  }

  get currentStatus(): MCPStatus {
    return this.status;
  }

  get currentTools(): MCPToolDef[] {
    return this.tools;
  }

  /** Namespaced tool name: serverName_toolName */
  toolName(rawName: string): string {
    return `${sanitize(this.config.name)}_${sanitize(rawName)}`;
  }

  /** Connect using appropriate transport */
  async connect(): Promise<void> {
    if (this.config.enabled === false) {
      this.setStatus({ status: "disabled" });
      return;
    }

    try {
      switch (this.config.type) {
        case "stdio":
          await this.connectStdio();
          break;
        case "http":
          // Streamable HTTP has no separate handshake — the initialize POST
          // below is both the connectivity probe and the auth check.
          this.sessionId = null;
          this.negotiatedVersion = null;
          break;
        case "sse":
          await this.connectSSE();
          break;
      }
      await this.initialize();
      await this.fetchTools();
      this.reconnectAttempts = 0;
      this.setStatus({ status: "connected" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unauthorized") || msg.includes("401")) {
        this.setStatus({ status: "needs_auth" });
      } else {
        this.setStatus({ status: "failed", error: msg });
      }
      throw err;
    }
  }

  /** Reconnect with exponential backoff */
  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus({ status: "failed", error: "Max reconnection attempts reached" });
      return;
    }
    this.reconnectAttempts++;
    this.setStatus({ status: "reconnecting", attempt: this.reconnectAttempts });
    const delay = RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1);
    await new Promise((r) => {
      this.reconnectTimer = setTimeout(r, delay);
    });
    try {
      await this.connect();
    } catch {
      await this.reconnect();
    }
  }

  /** Disconnect and clean up all resources */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.abortController?.abort();
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Client disconnected"));
    }
    this.pending.clear();
    if (this.sseReader) {
      try { await this.sseReader.cancel(); } catch {}
      this.sseReader = null;
    }
    if (this.process) {
      this.process.kill("SIGTERM");
      setTimeout(() => this.process?.kill("SIGKILL"), 5000);
      this.process = null;
    }
    this.sessionId = null;
    this.negotiatedVersion = null;
    this.setStatus({ status: "disabled" });
  }

  /** Call a tool on this MCP server */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.request("tools/call", { name, arguments: args });
    return result as MCPToolResult;
  }

  /** List available resources */
  async listResources(): Promise<MCPResource[]> {
    const result = (await this.request("resources/list")) as { resources: MCPResource[] };
    this.resources = result.resources ?? [];
    return this.resources;
  }

  // --- Private: Transport Connections ---

  private async connectStdio(): Promise<void> {
    if (!this.config.command) throw new Error("stdio transport requires 'command'");
    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
      cwd: this.config.cwd,
    });

    this.process.stdout!.on("data", (chunk: Buffer) => this.handleStdioData(chunk));
    this.process.stderr!.on("data", (chunk: Buffer) => {
      this.emit("log", { server: this.config.name, message: chunk.toString().trim() });
    });
    this.process.on("exit", (code) => {
      for (const [, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error(`MCP server exited with code ${code}`));
      }
      this.pending.clear();
      if (this.status.status === "connected") this.reconnect();
    });
    this.process.on("error", (err) => {
      this.setStatus({ status: "failed", error: err.message });
    });
  }

  private async connectSSE(): Promise<void> {
    if (!this.config.url) throw new Error("SSE transport requires 'url'");
    this.abortController = new AbortController();
    const headers = await this.buildHeaders();
    const resp = await fetch(this.config.url, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: this.abortController.signal,
    });
    if (resp.status === 401) {
      this.lastAuthChallenge = resp.headers.get("www-authenticate") ?? undefined;
      throw new Error("Unauthorized");
    }
    if (!resp.ok) throw new Error(`SSE ${resp.status}: ${resp.statusText}`);
    if (!resp.body) throw new Error("No response body for SSE");
    this.sseReader = resp.body.getReader();
    this.consumeSSE();
  }

  private async consumeSSE(): Promise<void> {
    if (!this.sseReader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await this.sseReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6));
              this.handleMessage(msg);
            } catch {}
          }
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        if (this.status.status === "connected") this.reconnect();
      }
    }
  }

  // --- Private: Protocol ---

  private async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: true } },
      clientInfo: { name: "ai-studio", version: "1.0.0" },
    })) as { capabilities?: Record<string, unknown>; protocolVersion?: string };
    this.serverCapabilities = result.capabilities ?? {};
    this.negotiatedVersion = result.protocolVersion ?? null;
    await this.notify("notifications/initialized");
  }

  private async fetchTools(): Promise<void> {
    try {
      const result = (await this.request("tools/list")) as { tools: MCPToolDef[] };
      this.tools = result.tools ?? [];
      this.emit("tools_changed", { server: this.config.name, tools: this.tools });
    } catch (err) {
      // Retry with lenient schema (omit outputSchema validation issues)
      if (err instanceof Error && /outputSchema|schema.*reference/i.test(err.message)) {
        try {
          const result = (await this.request("tools/list")) as { tools: MCPToolDef[] };
          this.tools = (result.tools ?? []).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          }));
        } catch {
          this.tools = [];
        }
      } else {
        this.tools = [];
      }
    }
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const timeout = this.config.timeout ?? DEFAULT_TIMEOUT;

    if (this.config.type === "stdio") {
      return this.stdioRequest(id, method, params, timeout);
    }
    return this.httpRequest(method, params, timeout);
  }

  private stdioRequest(id: number, method: string, params: unknown, timeout: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method} (${timeout}ms)`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params: params ?? undefined };
      this.process!.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  private async httpRequest(method: string, params: unknown, timeout: number): Promise<unknown> {
    const id = ++this.requestId;
    const body: JsonRpcRequest = { jsonrpc: "2.0", id, method, params: params ?? undefined };
    const resp = await this.postHttp(body, timeout);
    return this.readHttpResponse(resp, id);
  }

  /**
   * POST a JSON-RPC message per the Streamable HTTP transport: both response
   * shapes accepted, session id echoed, one silent token refresh on 401.
   */
  private async postHttp(body: JsonRpcRequest | JsonRpcNotification, timeout: number, retried = false): Promise<Response> {
    const headers = await this.buildHeaders();
    headers["Content-Type"] = "application/json";
    headers["Accept"] = "application/json, text/event-stream";
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.negotiatedVersion) headers["MCP-Protocol-Version"] = this.negotiatedVersion;

    const resp = await fetch(this.config.url!, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (resp.status === 401) {
      this.lastAuthChallenge = resp.headers.get("www-authenticate") ?? undefined;
      // Expired access token with a refresh token on file → refresh silently
      // and retry once before surfacing needs_auth.
      if (!retried && this.config.url && (await refreshTokens(this.config.name, this.config.url, this.auth, this.config.oauth))) {
        return this.postHttp(body, timeout, true);
      }
      throw new Error("Unauthorized");
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    return resp;
  }

  /** Extract the JSON-RPC result for `id` from a JSON or SSE-framed body. */
  private async readHttpResponse(resp: Response, id: number): Promise<unknown> {
    const contentType = resp.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // The server streams events; our response is one of the data messages.
      // Other messages on the stream (notifications, server requests) go
      // through the normal handler.
      if (!resp.body) throw new Error("Empty SSE response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data:")) {
              data += line.slice(5).trimStart();
            } else if (line.trim() === "" && data) {
              // Blank line = event boundary
              let msg: JsonRpcResponse | JsonRpcNotification | undefined;
              try { msg = JSON.parse(data); } catch {}
              data = "";
              if (!msg) continue;
              if ("id" in msg && msg.id === id) {
                const r = msg as JsonRpcResponse;
                if (r.error) throw new Error(r.error.message);
                return r.result;
              }
              this.handleMessage(msg);
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
      throw new Error("SSE stream ended without a response");
    }

    // 202/204 or empty body: valid for notifications, an error for requests.
    const text = await resp.text();
    if (!text) throw new Error("Empty response for request");
    const result = JSON.parse(text) as JsonRpcResponse;
    if (result.error) throw new Error(result.error.message);
    return result.result;
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params: params ?? undefined };
    if (this.config.type === "stdio") {
      this.process!.stdin!.write(JSON.stringify(msg) + "\n");
      return;
    }
    // Notifications carry no id; servers answer 202 with an empty body.
    await this.postHttp(msg, DEFAULT_TIMEOUT);
  }

  // --- Private: Data Handling ---

  private handleStdioData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {}
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in msg && msg.id != null) {
      const pending = this.pending.get(msg.id as number);
      if (pending) {
        this.pending.delete(msg.id as number);
        clearTimeout(pending.timer);
        if ((msg as JsonRpcResponse).error) {
          pending.reject(new Error((msg as JsonRpcResponse).error!.message));
        } else {
          pending.resolve((msg as JsonRpcResponse).result);
        }
      }
    } else if ("method" in msg) {
      this.handleNotification(msg as JsonRpcNotification);
    }
  }

  private handleNotification(msg: JsonRpcNotification): void {
    switch (msg.method) {
      case "notifications/tools/listChanged":
        this.fetchTools();
        break;
      case "notifications/resources/listChanged":
        this.listResources().catch(() => {});
        break;
      default:
        this.emit("notification", msg);
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...this.config.headers };
    // Tokens attach whenever we have them for this exact server URL — OAuth
    // needs no opt-in config; remote servers demand it via 401 at runtime.
    if (this.config.url && !headers["Authorization"]) {
      const entry = await this.auth.getForUrl(this.config.name, this.config.url);
      if (entry?.tokens?.accessToken) {
        headers["Authorization"] = `Bearer ${entry.tokens.accessToken}`;
      }
    }
    return headers;
  }

  private setStatus(status: MCPStatus): void {
    this.status = status;
    this.emit("status", { server: this.config.name, status });
  }
}

/**
 * MCPManager - Manages multiple MCP server connections
 * Handles lifecycle, tool aggregation, and namespacing
 */
export class MCPManager extends EventEmitter {
  private clients = new Map<string, MCPClient>();
  private auth: MCPAuth;
  private activeFlows = new Map<string, AuthFlowHandle>();

  constructor(auth: MCPAuth = new MCPAuth()) {
    super();
    this.auth = auth;
  }

  /** Connect to all configured MCP servers in parallel */
  async connectAll(configs: MCPServerConfig[]): Promise<void> {
    await Promise.allSettled(
      configs.map(async (config) => {
        const client = new MCPClient(config, this.auth);
        this.clients.set(config.name, client);
        client.on("status", (e) => this.emit("status", e));
        client.on("tools_changed", (e) => this.emit("tools_changed", e));
        client.on("log", (e) => this.emit("log", e));
        try {
          await client.connect();
        } catch {
          // Status already set by client
        }
      }),
    );
  }

  /** Disconnect all servers */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.values()).map((c) => c.disconnect()),
    );
    this.clients.clear();
  }

  /** Get all tools from all connected servers, namespaced */
  getAllTools(): Array<MCPToolDef & { server: string; namespacedName: string }> {
    const tools: Array<MCPToolDef & { server: string; namespacedName: string }> = [];
    for (const [, client] of this.clients) {
      if (client.currentStatus.status !== "connected") continue;
      for (const tool of client.currentTools) {
        tools.push({
          ...tool,
          server: client.name,
          namespacedName: client.toolName(tool.name),
        });
      }
    }
    return tools;
  }

  /** Call a namespaced tool */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    for (const [, client] of this.clients) {
      for (const tool of client.currentTools) {
        if (client.toolName(tool.name) === namespacedName) {
          return client.callTool(tool.name, args);
        }
      }
    }
    throw new Error(`Tool not found: ${namespacedName}`);
  }

  /** Get status of all servers */
  getStatus(): Record<string, MCPStatus> {
    const result: Record<string, MCPStatus> = {};
    for (const [name, client] of this.clients) {
      result[name] = client.currentStatus;
    }
    return result;
  }

  /** Get config + status + tools for every connected/registered server. */
  getServers(): Array<{ config: MCPServerConfig; status: MCPStatus; tools: MCPToolDef[] }> {
    const result: Array<{ config: MCPServerConfig; status: MCPStatus; tools: MCPToolDef[] }> = [];
    for (const [, client] of this.clients) {
      result.push({
        config: (client as any).config as MCPServerConfig,
        status: client.currentStatus,
        tools: client.currentTools,
      });
    }
    return result;
  }

  /** Add and connect a single server at runtime. */
  async addServer(config: MCPServerConfig): Promise<{ config: MCPServerConfig; status: MCPStatus; tools: MCPToolDef[] }> {
    await this.removeServer(config.name);
    const client = new MCPClient(config, this.auth);
    this.clients.set(config.name, client);
    client.on("status", (e) => this.emit("status", e));
    client.on("tools_changed", (e) => this.emit("tools_changed", e));
    client.on("log", (e) => this.emit("log", e));
    try {
      await client.connect();
    } catch {
      // Status already set by client
    }
    return { config, status: client.currentStatus, tools: client.currentTools };
  }

  /**
   * Disconnect and remove a single server. `forgetAuth` also drops stored
   * OAuth tokens — pass it on explicit user removal, never on the internal
   * remove that add/reconnect performs (reconnecting must keep tokens).
   */
  async removeServer(name: string, opts?: { forgetAuth?: boolean }): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.disconnect();
      this.clients.delete(name);
    }
    if (opts?.forgetAuth) await this.auth.remove(name);
  }

  /** Reconnect a single server using its existing config. */
  async reconnectServer(name: string): Promise<{ config: MCPServerConfig; status: MCPStatus; tools: MCPToolDef[] } | null> {
    const client = this.clients.get(name);
    if (!client) return null;
    const config = (client as any).config as MCPServerConfig;
    return this.addServer(config);
  }

  /** Get a specific client */
  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Start the interactive OAuth flow for a server: discovery, dynamic client
   * registration, PKCE, and a one-shot loopback callback server. Returns the
   * authorization URL to open plus a `complete` promise that resolves once
   * tokens are stored. An in-flight flow for the same server is cancelled
   * first (last click wins).
   */
  async startAuth(name: string): Promise<AuthFlowHandle> {
    const client = this.clients.get(name);
    if (!client) throw new Error(`MCP server "${name}" not found`);
    const config = (client as any).config as MCPServerConfig;
    if (!config.url) throw new Error(`MCP server "${name}" is not a remote server — nothing to authenticate.`);

    this.activeFlows.get(name)?.cancel();
    const handle = await startAuthFlow(name, config.url, this.auth, {
      oauth: config.oauth,
      wwwAuthenticate: client.authChallenge,
    });
    this.activeFlows.set(name, handle);
    handle.complete.finally(() => {
      if (this.activeFlows.get(name) === handle) this.activeFlows.delete(name);
    }).catch(() => {});
    return handle;
  }
}
