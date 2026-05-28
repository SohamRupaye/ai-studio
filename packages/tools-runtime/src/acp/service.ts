/**
 * ACP (Agent Communication Protocol) - IDE integration service
 * Enables VS Code, Zed, and other editors to communicate with AI agents
 */
import { EventEmitter } from "events";
import * as http from "http";

// --- Types ---

export interface ACPCapabilities {
  mcp: { http: boolean; sse: boolean };
  prompt: { embeddedContext: boolean; image: boolean };
  session: { close: boolean; fork: boolean; list: boolean; resume: boolean };
  loadSession: boolean;
}

export interface ACPSessionInfo {
  id: string;
  model?: string;
  mode?: string;
  cwd: string;
  createdAt: number;
}

export interface ACPMessage {
  role: "user" | "assistant";
  content: ACPContentBlock[];
}

export type ACPContentBlock =
  | { type: "text"; text: string; audience?: "user" | "assistant" }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name?: string }
  | { type: "resource"; uri: string; text?: string; blob?: string; mimeType?: string };

export interface ACPToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  state: "pending" | "running" | "completed" | "error";
  output?: string;
  error?: string;
}

export type ACPSessionUpdate =
  | { type: "agent_message_chunk"; text: string }
  | { type: "agent_thought_chunk"; text: string }
  | { type: "tool_call"; call: ACPToolCall }
  | { type: "tool_call_update"; call: ACPToolCall }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type PermissionDecision = "allow_once" | "allow_always" | "reject";

export interface PermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface ACPConfigOption {
  key: string;
  label: string;
  type: "select" | "text";
  options?: Array<{ value: string; label: string }>;
  value: string;
}

export interface ACPMCPServer {
  name: string;
  type: "local" | "remote";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

// --- Connection Interface ---

export interface ACPConnection {
  send(update: ACPSessionUpdate): void;
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>;
  writeTextFile?(path: string, content: string): Promise<void>;
  close(): void;
}

// --- Service ---

export type PromptHandler = (
  sessionId: string,
  content: ACPContentBlock[],
  mcpServers?: ACPMCPServer[],
) => AsyncGenerator<ACPSessionUpdate>;

export type SessionHandler = {
  create: (opts: { model?: string; mode?: string; cwd?: string; mcpServers?: ACPMCPServer[] }) => Promise<ACPSessionInfo>;
  load: (id: string) => Promise<{ session: ACPSessionInfo; messages: ACPMessage[] } | null>;
  list: (cursor?: string, limit?: number) => Promise<{ sessions: ACPSessionInfo[]; nextCursor?: string }>;
  close: (id: string) => Promise<void>;
  fork: (id: string) => Promise<ACPSessionInfo | null>;
  resume: (id: string) => Promise<{ session: ACPSessionInfo; messages: ACPMessage[] } | null>;
};

export interface ACPServiceConfig {
  name?: string;
  version?: string;
  port?: number;
  host?: string;
  auth?: { method: string; validate: (token: string) => Promise<boolean> };
  onPrompt: PromptHandler;
  sessions: SessionHandler;
  capabilities?: Partial<ACPCapabilities>;
  configOptions?: () => Promise<ACPConfigOption[]>;
  setConfigOption?: (sessionId: string, key: string, value: string) => Promise<void>;
  onCancel?: (sessionId: string) => Promise<void>;
}

/**
 * ACP Service - HTTP + SSE server implementing the Agent Communication Protocol
 */
export class ACPService extends EventEmitter {
  private server: http.Server | null = null;
  private connections = new Map<string, ACPConnection>();
  private config: ACPServiceConfig;
  private capabilities: ACPCapabilities;

  constructor(config: ACPServiceConfig) {
    super();
    this.config = config;
    this.capabilities = {
      mcp: { http: true, sse: true },
      prompt: { embeddedContext: true, image: true },
      session: { close: true, fork: true, list: true, resume: true },
      loadSession: true,
      ...config.capabilities,
    };
  }

  /** Start the ACP server */
  async start(): Promise<number> {
    const port = this.config.port ?? 0;
    const host = this.config.host ?? "127.0.0.1";

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        const addr = this.server!.address() as { port: number };
        this.emit("started", { port: addr.port });
        resolve(addr.port);
      });
    });
  }

  /** Stop the ACP server */
  async stop(): Promise<void> {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    return new Promise((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // Auth
    if (this.config.auth) {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token || !(await this.config.auth.validate(token))) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const body = await this.readBody(req);

    try {
      switch (url.pathname) {
        case "/acp/initialize":
          await this.handleInitialize(body, res);
          break;
        case "/acp/session/new":
          await this.handleNewSession(body, res);
          break;
        case "/acp/session/load":
          await this.handleLoadSession(body, res);
          break;
        case "/acp/session/list":
          await this.handleListSessions(body, res);
          break;
        case "/acp/session/close":
          await this.handleCloseSession(body, res);
          break;
        case "/acp/session/fork":
          await this.handleForkSession(body, res);
          break;
        case "/acp/session/resume":
          await this.handleResumeSession(body, res);
          break;
        case "/acp/prompt":
          await this.handlePrompt(body, req, res);
          break;
        case "/acp/cancel":
          await this.handleCancel(body, res);
          break;
        case "/acp/config/options":
          await this.handleConfigOptions(res);
          break;
        case "/acp/config/set":
          await this.handleSetConfig(body, res);
          break;
        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
    }
  }

  private async handleInitialize(_body: unknown, res: http.ServerResponse): Promise<void> {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      protocol: 1,
      agent: { name: this.config.name ?? "ai-studio", version: this.config.version ?? "1.0.0" },
      capabilities: this.capabilities,
      auth: this.config.auth ? { methods: [this.config.auth.method] } : undefined,
    }));
  }

  private async handleNewSession(body: any, res: http.ServerResponse): Promise<void> {
    const session = await this.config.sessions.create({
      model: body?.model,
      mode: body?.mode,
      cwd: body?.cwd,
      mcpServers: body?.mcpServers,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ session }));
  }

  private async handleLoadSession(body: any, res: http.ServerResponse): Promise<void> {
    const result = await this.config.sessions.load(body?.id);
    if (!result) { res.writeHead(404); res.end(JSON.stringify({ error: "Session not found" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  private async handleListSessions(body: any, res: http.ServerResponse): Promise<void> {
    const result = await this.config.sessions.list(body?.cursor, body?.limit);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  private async handleCloseSession(body: any, res: http.ServerResponse): Promise<void> {
    await this.config.sessions.close(body?.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleForkSession(body: any, res: http.ServerResponse): Promise<void> {
    const forked = await this.config.sessions.fork(body?.id);
    if (!forked) { res.writeHead(404); res.end(JSON.stringify({ error: "Session not found" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ session: forked }));
  }

  private async handleResumeSession(body: any, res: http.ServerResponse): Promise<void> {
    const result = await this.config.sessions.resume(body?.id);
    if (!result) { res.writeHead(404); res.end(JSON.stringify({ error: "Session not found" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  private async handlePrompt(body: any, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sessionId = body?.sessionId;
    const content = body?.content as ACPContentBlock[] ?? [];
    const mcpServers = body?.mcpServers as ACPMCPServer[] | undefined;

    // SSE streaming response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const connection: ACPConnection = {
      send: (update) => {
        res.write(`data: ${JSON.stringify(update)}\n\n`);
      },
      requestPermission: async (request) => {
        // Send permission request as SSE event, wait for response via separate endpoint
        res.write(`event: permission_request\ndata: ${JSON.stringify(request)}\n\n`);
        return new Promise<PermissionDecision>((resolve) => {
          this.once(`permission_response:${request.id}`, resolve);
          setTimeout(() => resolve("reject"), 30_000); // 30s timeout
        });
      },
      close: () => { try { res.end(); } catch {} },
    };
    this.connections.set(sessionId, connection);

    try {
      for await (const update of this.config.onPrompt(sessionId, content, mcpServers)) {
        connection.send(update);
      }
    } catch (err) {
      connection.send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
    connection.send({ type: "done", messageId: crypto.randomUUID() });
    this.connections.delete(sessionId);
    res.end();
  }

  private async handleCancel(body: any, res: http.ServerResponse): Promise<void> {
    if (this.config.onCancel) await this.config.onCancel(body?.sessionId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleConfigOptions(res: http.ServerResponse): Promise<void> {
    const options = this.config.configOptions ? await this.config.configOptions() : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ options }));
  }

  private async handleSetConfig(body: any, res: http.ServerResponse): Promise<void> {
    if (this.config.setConfigOption) {
      await this.config.setConfigOption(body?.sessionId, body?.key, body?.value);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  /** Handle permission response from client (call externally) */
  resolvePermission(requestId: string, decision: PermissionDecision): void {
    this.emit(`permission_response:${requestId}`, decision);
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      if (req.method === "GET") { resolve(null); return; }
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
  }
}
