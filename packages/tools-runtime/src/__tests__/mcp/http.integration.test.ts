import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCPClient } from "../../mcp/client.js";
import { MCPAuth } from "../../mcp/auth.js";

/**
 * A fake Streamable HTTP MCP server: JSON response to initialize (with a
 * session id), 202 to notifications, SSE-framed response to tools/list, and
 * optional bearer-token enforcement for the auth tests.
 */
class FakeStreamableServer {
  server!: http.Server;
  origin = "";
  url = "";
  requiredToken: string | null = null;
  refreshedToken = "fresh-token";
  seen: Array<{ method?: string; sessionId?: string; accept?: string; auth?: string }> = [];

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const addr = this.server.address() as { port: number };
    this.origin = `http://127.0.0.1:${addr.port}`;
    this.url = `${this.origin}/mcp`;
  }

  async stop(): Promise<void> {
    await new Promise((r) => this.server.close(r));
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", this.origin);

    // Minimal discovery + token endpoint for the silent-refresh test.
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ resource: this.url, authorization_servers: [this.origin] }));
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: this.origin,
          authorization_endpoint: `${this.origin}/authorize`,
          token_endpoint: `${this.origin}/token`,
        }),
      );
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        if (params.get("grant_type") !== "refresh_token") {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: this.refreshedToken, expires_in: 3600 }));
      });
      return;
    }

    if (url.pathname !== "/mcp" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body) as { id?: number; method: string };
      this.seen.push({
        method: msg.method,
        sessionId: req.headers["mcp-session-id"] as string | undefined,
        accept: req.headers["accept"] as string | undefined,
        auth: req.headers["authorization"] as string | undefined,
      });

      if (this.requiredToken && req.headers["authorization"] !== `Bearer ${this.requiredToken}`) {
        res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp"` });
        res.end();
        return;
      }

      if (msg.id == null) {
        // Notification → 202, empty body (the spec shape).
        res.writeHead(202).end();
        return;
      }
      if (msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-1" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
          }),
        );
        return;
      }
      // Everything after initialize must carry the session id.
      if (req.headers["mcp-session-id"] !== "sess-1") {
        res.writeHead(400).end();
        return;
      }
      if (msg.method === "tools/list") {
        // SSE-framed response, with an unrelated notification interleaved
        // first — the client must skip past it to its own response.
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: {"jsonrpc":"2.0","method":"notifications/unrelated"}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { tools: [{ name: "search", inputSchema: { type: "object" } }] },
          })}\n\n`,
        );
        res.end();
        return;
      }
      if (msg.method === "tools/call") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: "ok" }] },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    });
  }
}

let fake: FakeStreamableServer;
let tmpDir: string;
let auth: MCPAuth;
let client: MCPClient | undefined;

beforeEach(async () => {
  fake = new FakeStreamableServer();
  await fake.start();
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-http-test-"));
  auth = new MCPAuth(join(tmpDir, "auth.json"));
});

afterEach(async () => {
  await client?.disconnect();
  client = undefined;
  await fake.stop();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("MCPClient (streamable HTTP, fixture-backed)", () => {
  it("initializes, echoes the session id, and parses an SSE-framed response", async () => {
    client = new MCPClient({ name: "fake", type: "http", url: fake.url }, auth);
    await client.connect();

    expect(client.currentStatus).toEqual({ status: "connected" });
    expect(client.currentTools.map((t) => t.name)).toEqual(["search"]);

    const result = await client.callTool("search", { q: "x" });
    expect(result.content[0]?.text).toBe("ok");

    // Every POST advertised both response shapes.
    for (const r of fake.seen) expect(r.accept).toContain("text/event-stream");
    // initialize had no session; everything after echoed the server's.
    expect(fake.seen[0]?.sessionId).toBeUndefined();
    for (const r of fake.seen.slice(1)) expect(r.sessionId).toBe("sess-1");
    // The initialized notification went out (and got a bodyless 202 back).
    expect(fake.seen.some((r) => r.method === "notifications/initialized")).toBe(true);
  });

  it("lands on needs_auth and captures the WWW-Authenticate challenge on 401", async () => {
    fake.requiredToken = "something-we-lack";
    client = new MCPClient({ name: "fake", type: "http", url: fake.url }, auth);

    await expect(client.connect()).rejects.toThrow(/Unauthorized/);
    expect(client.currentStatus).toEqual({ status: "needs_auth" });
    expect(client.authChallenge).toContain("resource_metadata=");
  });

  it("silently refreshes an expired token on 401 and retries", async () => {
    fake.requiredToken = "fresh-token";
    await auth.updateClientInfo("fake", { clientId: "dyn-client-1" }, fake.url);
    await auth.updateTokens("fake", { accessToken: "stale", refreshToken: "r1" }, fake.url);

    client = new MCPClient({ name: "fake", type: "http", url: fake.url }, auth);
    await client.connect();

    expect(client.currentStatus).toEqual({ status: "connected" });
    const entry = await auth.getForUrl("fake", fake.url);
    expect(entry?.tokens?.accessToken).toBe("fresh-token");
    // The stale attempt got 401, the retry carried the refreshed token.
    expect(fake.seen[0]?.auth).toBe("Bearer stale");
    expect(fake.seen[1]?.auth).toBe("Bearer fresh-token");
  });

  it("attaches stored tokens without any oauth config", async () => {
    fake.requiredToken = "have-this";
    await auth.updateTokens("fake", { accessToken: "have-this" }, fake.url);

    client = new MCPClient({ name: "fake", type: "http", url: fake.url }, auth);
    await client.connect();
    expect(client.currentStatus).toEqual({ status: "connected" });
  });

  it("authenticates with a static Authorization header (access-token connect)", async () => {
    fake.requiredToken = "my-pat";
    client = new MCPClient(
      { name: "fake", type: "http", url: fake.url, headers: { Authorization: "Bearer my-pat" } },
      auth,
    );
    await client.connect();
    expect(client.currentStatus).toEqual({ status: "connected" });
    // The configured header wins over any stored OAuth token.
    expect(fake.seen[0]?.auth).toBe("Bearer my-pat");
  });
});
