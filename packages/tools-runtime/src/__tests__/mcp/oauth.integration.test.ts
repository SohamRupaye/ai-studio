import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCPAuth } from "../../mcp/auth.js";
import {
  discoverOAuth,
  startAuthFlow,
  refreshTokens,
  resourceMetadataFromChallenge,
} from "../../mcp/oauth.js";

/**
 * A fake OAuth-capable MCP host: serves RFC 9728 protected-resource metadata,
 * RFC 8414 auth-server metadata, RFC 7591 registration, and a token endpoint
 * that validates PKCE. The test acts as the user's browser.
 */
class FakeAuthServer {
  server!: http.Server;
  origin = "";
  registrations: Array<Record<string, unknown>> = [];
  tokenRequests: Array<URLSearchParams> = [];
  issuedCode = "test-code-123";
  expectedChallenge: string | null = null;
  refreshOutcome: "ok" | "fail" = "ok";
  serveWellKnown = true;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const addr = this.server.address() as { port: number };
    this.origin = `http://127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    await new Promise((r) => this.server.close(r));
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", this.origin);
    if (!this.serveWellKnown && url.pathname.startsWith("/.well-known/")) {
      res.writeHead(404).end();
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      this.json(res, 200, {
        resource: `${this.origin}/mcp`,
        authorization_servers: [this.origin],
        scopes_supported: ["mcp.read", "mcp.write"],
      });
    } else if (url.pathname === "/.well-known/oauth-authorization-server") {
      this.json(res, 200, {
        issuer: this.origin,
        authorization_endpoint: `${this.origin}/authorize`,
        token_endpoint: `${this.origin}/token`,
        registration_endpoint: `${this.origin}/register`,
      });
    } else if (url.pathname === "/register" && req.method === "POST") {
      this.collectBody(req, (body) => {
        const reg = JSON.parse(body) as Record<string, unknown>;
        this.registrations.push(reg);
        this.json(res, 201, { client_id: "dyn-client-1", client_id_issued_at: 1 });
      });
    } else if (url.pathname === "/token" && req.method === "POST") {
      this.collectBody(req, (body) => {
        const params = new URLSearchParams(body);
        this.tokenRequests.push(params);
        if (params.get("grant_type") === "refresh_token") {
          if (this.refreshOutcome === "fail") {
            this.json(res, 400, { error: "invalid_grant" });
          } else {
            this.json(res, 200, { access_token: "refreshed-token", expires_in: 3600 });
          }
          return;
        }
        // Authorization-code exchange: validate the code and PKCE verifier.
        if (params.get("code") !== this.issuedCode) {
          this.json(res, 400, { error: "invalid_grant", error_description: "bad code" });
          return;
        }
        const verifier = params.get("code_verifier") ?? "";
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (this.expectedChallenge && challenge !== this.expectedChallenge) {
          this.json(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
          return;
        }
        this.json(res, 200, {
          access_token: "access-token-abc",
          refresh_token: "refresh-token-xyz",
          expires_in: 3600,
          scope: "mcp.read",
        });
      });
    } else {
      res.writeHead(404).end();
    }
  }

  private collectBody(req: http.IncomingMessage, cb: (body: string) => void): void {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => cb(body));
  }
}

let fake: FakeAuthServer;
let tmpDir: string;
let auth: MCPAuth;

beforeEach(async () => {
  fake = new FakeAuthServer();
  await fake.start();
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-oauth-test-"));
  auth = new MCPAuth(join(tmpDir, "auth.json"));
});

afterEach(async () => {
  await fake.stop();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resourceMetadataFromChallenge", () => {
  it("extracts the resource_metadata URL from a WWW-Authenticate challenge", () => {
    expect(
      resourceMetadataFromChallenge(
        'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toBe("https://example.com/.well-known/oauth-protected-resource/mcp");
    expect(resourceMetadataFromChallenge("Bearer realm=api")).toBeUndefined();
    expect(resourceMetadataFromChallenge(undefined)).toBeUndefined();
  });
});

describe("discoverOAuth", () => {
  it("walks protected-resource metadata to the authorization server", async () => {
    const d = await discoverOAuth(`${fake.origin}/mcp`);
    expect(d.metadata.authorization_endpoint).toBe(`${fake.origin}/authorize`);
    expect(d.metadata.token_endpoint).toBe(`${fake.origin}/token`);
    expect(d.metadata.registration_endpoint).toBe(`${fake.origin}/register`);
    expect(d.resource).toBe(`${fake.origin}/mcp`);
    expect(d.scopes).toEqual(["mcp.read", "mcp.write"]);
  });

  it("falls back to spec-default endpoints when no metadata is served", async () => {
    fake.serveWellKnown = false;
    const d = await discoverOAuth(`${fake.origin}/mcp`);
    expect(d.metadata.authorization_endpoint).toBe(`${fake.origin}/authorize`);
    expect(d.metadata.token_endpoint).toBe(`${fake.origin}/token`);
    expect(d.resource).toBe(`${fake.origin}/mcp`);
  });
});

describe("startAuthFlow", () => {
  it("registers a client, runs the PKCE code flow via loopback, and stores tokens", async () => {
    const flow = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);

    const authUrl = new URL(flow.url);
    expect(authUrl.pathname).toBe("/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe("dyn-client-1");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("resource")).toBe(`${fake.origin}/mcp`);
    expect(authUrl.searchParams.get("scope")).toBe("mcp.read mcp.write");
    const redirectUri = authUrl.searchParams.get("redirect_uri")!;
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    // Registration carried the loopback redirect and no client secret.
    expect(fake.registrations[0]?.["redirect_uris"]).toEqual([redirectUri]);
    expect(fake.registrations[0]?.["token_endpoint_auth_method"]).toBe("none");

    // Act as the browser: the AS redirects back with code + state.
    fake.expectedChallenge = authUrl.searchParams.get("code_challenge");
    const cb = new URL(redirectUri);
    cb.searchParams.set("code", fake.issuedCode);
    cb.searchParams.set("state", authUrl.searchParams.get("state")!);
    const resp = await fetch(cb.toString());
    expect(resp.status).toBe(200);

    await flow.complete;

    const entry = await auth.getForUrl("fake", `${fake.origin}/mcp`);
    expect(entry?.tokens?.accessToken).toBe("access-token-abc");
    expect(entry?.tokens?.refreshToken).toBe("refresh-token-xyz");
    expect(entry?.clientInfo?.clientId).toBe("dyn-client-1");
    // Token exchange was a proper form-encoded PKCE request.
    const exchange = fake.tokenRequests[0]!;
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("redirect_uri")).toBe(redirectUri);
    expect(exchange.get("code_verifier")).toBeTruthy();
  });

  it("rejects a callback whose state doesn't match", async () => {
    const flow = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    const redirectUri = new URL(flow.url).searchParams.get("redirect_uri")!;
    const cb = new URL(redirectUri);
    cb.searchParams.set("code", fake.issuedCode);
    cb.searchParams.set("state", "forged-state");
    // Attach the rejection handler BEFORE triggering the callback so the
    // promise is never transiently unhandled (avoids PromiseRejectionHandledWarning).
    const completePromise = expect(flow.complete).rejects.toThrow(/state mismatch/);
    const resp = await fetch(cb.toString());
    expect(resp.status).toBe(400);
    await completePromise;
    const entry = await auth.get("fake");
    expect(entry?.tokens).toBeUndefined();
  });

  it("surfaces an authorization error from the callback", async () => {
    const flow = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    const redirectUri = new URL(flow.url).searchParams.get("redirect_uri")!;
    const cb = new URL(redirectUri);
    cb.searchParams.set("error", "access_denied");
    cb.searchParams.set("error_description", "User said no");
    // Attach the rejection handler BEFORE triggering the callback so the
    // promise is never transiently unhandled (avoids PromiseRejectionHandledWarning).
    const completePromise = expect(flow.complete).rejects.toThrow("User said no");
    await fetch(cb.toString());
    await completePromise;
  });

  it("can be cancelled, which frees the loopback server", async () => {
    const flow = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    flow.cancel();
    await expect(flow.complete).rejects.toThrow(/cancelled/);
    // The port is free again: a second flow can bind the same preferred port.
    const flow2 = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    flow2.cancel();
    await flow2.complete.catch(() => {});
  });

  it("uses an explicitly configured client instead of registering (pre-registered app path)", async () => {
    const flow = await startAuthFlow("fake", `${fake.origin}/mcp`, auth, {
      oauth: { clientId: "preset-client", clientSecret: "preset-secret", scope: "narrow.scope" },
    });
    const authUrl = new URL(flow.url);
    expect(authUrl.searchParams.get("client_id")).toBe("preset-client");
    expect(authUrl.searchParams.get("scope")).toBe("narrow.scope");
    expect(fake.registrations.length).toBe(0);

    fake.expectedChallenge = authUrl.searchParams.get("code_challenge");
    const cb = new URL(authUrl.searchParams.get("redirect_uri")!);
    cb.searchParams.set("code", fake.issuedCode);
    cb.searchParams.set("state", authUrl.searchParams.get("state")!);
    await fetch(cb.toString());
    await flow.complete;

    // The exchange carried the configured secret alongside PKCE.
    const exchange = fake.tokenRequests[0]!;
    expect(exchange.get("client_id")).toBe("preset-client");
    expect(exchange.get("client_secret")).toBe("preset-secret");
    const entry = await auth.getForUrl("fake", `${fake.origin}/mcp`);
    expect(entry?.tokens?.accessToken).toBe("access-token-abc");
  });

  it("reuses the stored client registration for the same redirect URI", async () => {
    const first = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    first.cancel();
    await first.complete.catch(() => {});
    const second = await startAuthFlow("fake", `${fake.origin}/mcp`, auth);
    second.cancel();
    await second.complete.catch(() => {});
    expect(fake.registrations.length).toBe(1);
  });
});

describe("refreshTokens", () => {
  beforeEach(async () => {
    await auth.updateClientInfo("fake", { clientId: "dyn-client-1" }, `${fake.origin}/mcp`);
    await auth.updateTokens(
      "fake",
      { accessToken: "stale", refreshToken: "refresh-token-xyz" },
      `${fake.origin}/mcp`,
    );
  });

  it("exchanges the refresh token and keeps the old one when none is returned", async () => {
    const ok = await refreshTokens("fake", `${fake.origin}/mcp`, auth);
    expect(ok).toBe(true);
    const entry = await auth.getForUrl("fake", `${fake.origin}/mcp`);
    expect(entry?.tokens?.accessToken).toBe("refreshed-token");
    expect(entry?.tokens?.refreshToken).toBe("refresh-token-xyz");
  });

  it("returns false on a failed grant without clobbering stored tokens", async () => {
    fake.refreshOutcome = "fail";
    const ok = await refreshTokens("fake", `${fake.origin}/mcp`, auth);
    expect(ok).toBe(false);
    const entry = await auth.getForUrl("fake", `${fake.origin}/mcp`);
    expect(entry?.tokens?.accessToken).toBe("stale");
  });

  it("returns false when there is no refresh token", async () => {
    const bare = new MCPAuth(join(tmpDir, "bare.json"));
    expect(await refreshTokens("fake", `${fake.origin}/mcp`, bare)).toBe(false);
  });
});
