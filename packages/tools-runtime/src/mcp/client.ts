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
  private auth = new MCPAuth();
  private serverCapabilities: Record<string, unknown> = {};

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
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
          await this.connectHTTP();
          break;
        case "sse":
          await this.connectSSE();
          break;
      }
      this.reconnectAttempts = 0;
      this.setStatus({ status: "connected" });
      await this.initialize();
      await this.fetchTools();
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

  private async connectHTTP(): Promise<void> {
    if (!this.config.url) throw new Error("HTTP transport requires 'url'");
    // Verify connectivity with a GET to the endpoint
    const headers = await this.buildHeaders();
    const resp = await fetch(this.config.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.config.timeout ?? DEFAULT_TIMEOUT),
    });
    if (resp.status === 401) throw new Error("Unauthorized");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  private async connectSSE(): Promise<void> {
    if (!this.config.url) throw new Error("SSE transport requires 'url'");
    this.abortController = new AbortController();
    const headers = await this.buildHeaders();
    const resp = await fetch(this.config.url, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: this.abortController.signal,
    });
    if (resp.status === 401) throw new Error("Unauthorized");
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
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: true } },
      clientInfo: { name: "ai-studio", version: "1.0.0" },
    })) as { capabilities?: Record<string, unknown> };
    this.serverCapabilities = result.capabilities ?? {};
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
    const headers = await this.buildHeaders();
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params: params ?? undefined,
    };
    const resp = await fetch(this.config.url!, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (resp.status === 401) throw new Error("Unauthorized");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = (await resp.json()) as JsonRpcResponse;
    if (result.error) throw new Error(result.error.message);
    return result.result;
  }

  private notify(method: string, params?: unknown): Promise<void> {
    if (this.config.type === "stdio") {
      const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params: params ?? undefined };
      this.process!.stdin!.write(JSON.stringify(msg) + "\n");
      return Promise.resolve();
    }
    return this.httpRequest(method, params, DEFAULT_TIMEOUT).then(() => {});
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
    if (this.config.oauth && this.config.url) {
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
  private auth = new MCPAuth();

  /** Connect to all configured MCP servers in parallel */
  async connectAll(configs: MCPServerConfig[]): Promise<void> {
    await Promise.allSettled(
      configs.map(async (config) => {
        const client = new MCPClient(config);
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
    const client = new MCPClient(config);
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

  /** Disconnect and remove a single server. */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;
    await client.disconnect();
    this.clients.delete(name);
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

  /** Start OAuth flow for a server that needs auth */
  async startAuth(name: string): Promise<string | undefined> {
    const client = this.clients.get(name);
    if (!client) return undefined;
    const config = (client as any).config as MCPServerConfig;
    if (!config.oauth || !config.url) return undefined;

    // Generate state for CSRF protection
    const state = crypto.randomUUID();
    await this.auth.setState(name, state);

    // Build authorization URL (simplified - real impl would use discovery)
    const url = new URL(config.url);
    url.pathname = "/oauth/authorize";
    url.searchParams.set("client_id", config.oauth.clientId ?? "");
    url.searchParams.set("state", state);
    url.searchParams.set(
      "redirect_uri",
      config.oauth.redirectUri ?? `http://127.0.0.1:${config.oauth.callbackPort ?? 19876}/mcp/oauth/callback`,
    );
    if (config.oauth.scope) url.searchParams.set("scope", config.oauth.scope);
    return url.toString();
  }

  /** Complete OAuth flow after callback */
  async finishAuth(name: string, code: string, state: string): Promise<boolean> {
    const savedState = await this.auth.getState(name);
    if (savedState !== state) return false;
    const client = this.clients.get(name);
    if (!client) return false;
    const config = (client as any).config as MCPServerConfig;
    if (!config.url) return false;

    // Exchange code for tokens (simplified)
    const url = new URL(config.url);
    url.pathname = "/oauth/token";
    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, grant_type: "authorization_code" }),
    });
    if (!resp.ok) return false;
    const tokens = await resp.json();
    await this.auth.updateTokens(name, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
    }, config.url);
    await this.auth.clearCodeVerifier(name);

    // Reconnect
    try { await client.connect(); } catch { return false; }
    return true;
  }
}
