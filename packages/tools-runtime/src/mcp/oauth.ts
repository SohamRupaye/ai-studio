/**
 * MCP OAuth 2.1 — the real authorization flow for remote MCP servers.
 *
 * Implements what the MCP authorization spec requires of clients:
 *  - RFC 9728 protected-resource metadata discovery (via WWW-Authenticate
 *    `resource_metadata` or the well-known path)
 *  - RFC 8414 authorization-server metadata discovery (with the OIDC
 *    well-known fallback)
 *  - RFC 7591 dynamic client registration (public client, PKCE, no secret)
 *  - Authorization-code flow with PKCE (S256) over a one-shot loopback
 *    redirect (http://127.0.0.1:<port>/callback)
 *  - RFC 8707 resource indicators on both authorize and token requests
 *  - Refresh-token grant for silent re-auth on 401
 *
 * Nothing here opens a browser — callers get the authorization URL back and
 * decide how to present it (the desktop app uses shell.openExternal).
 */
import * as http from "node:http";
import * as crypto from "node:crypto";
import type { MCPAuth } from "./auth.js";
import type { OAuthConfig } from "./types.js";

const DISCOVERY_TIMEOUT = 10_000;
const FLOW_TIMEOUT = 5 * 60_000; // user is off in a browser — give them time
const DEFAULT_CALLBACK_PORT = 19876;
const CALLBACK_PATH = "/callback";

export interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface OAuthDiscovery {
  metadata: AuthServerMetadata;
  /** RFC 8707 resource indicator — the protected resource's canonical id. */
  resource: string;
  /** Scopes advertised by the protected resource (preferred over AS-wide). */
  scopes?: string[];
}

export interface AuthFlowHandle {
  /** The authorization URL to open in the user's browser. */
  url: string;
  /** Resolves once the callback landed and tokens are stored; rejects on
   * timeout, state mismatch, or a failed code exchange. */
  complete: Promise<void>;
  /** Abort the flow early (closes the loopback server). */
  cancel: () => void;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Candidate metadata URLs for an issuer, RFC 8414 path-aware first. */
function metadataCandidates(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/$/, "");
  const c: string[] = [];
  if (path && path !== "") {
    c.push(`${u.origin}/.well-known/oauth-authorization-server${path}`);
    c.push(`${u.origin}/.well-known/openid-configuration${path}`);
    c.push(`${u.origin}${path}/.well-known/openid-configuration`);
  }
  c.push(`${u.origin}/.well-known/oauth-authorization-server`);
  c.push(`${u.origin}/.well-known/openid-configuration`);
  return c;
}

/** Parse `resource_metadata="…"` out of a WWW-Authenticate challenge. */
export function resourceMetadataFromChallenge(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const m = /resource_metadata="([^"]+)"/i.exec(header);
  return m?.[1];
}

/**
 * Discover the authorization server for an MCP endpoint.
 * `wwwAuthenticate` is the challenge header from the 401, when we have one.
 */
export async function discoverOAuth(serverUrl: string, wwwAuthenticate?: string): Promise<OAuthDiscovery> {
  const server = new URL(serverUrl);
  const canonicalResource = server.origin + server.pathname.replace(/\/$/, "");

  // 1. Protected-resource metadata (RFC 9728)
  const prmUrls: string[] = [];
  const fromChallenge = resourceMetadataFromChallenge(wwwAuthenticate);
  if (fromChallenge) prmUrls.push(fromChallenge);
  const path = server.pathname.replace(/\/$/, "");
  if (path) prmUrls.push(`${server.origin}/.well-known/oauth-protected-resource${path}`);
  prmUrls.push(`${server.origin}/.well-known/oauth-protected-resource`);

  let issuer = server.origin;
  let resource = canonicalResource;
  let scopes: string[] | undefined;
  for (const url of prmUrls) {
    const prm = await fetchJson(url);
    if (!prm) continue;
    const servers = prm["authorization_servers"];
    if (Array.isArray(servers) && typeof servers[0] === "string") issuer = servers[0];
    if (typeof prm["resource"] === "string") resource = prm["resource"];
    if (Array.isArray(prm["scopes_supported"])) scopes = prm["scopes_supported"] as string[];
    break;
  }

  // 2. Authorization-server metadata (RFC 8414 / OIDC)
  for (const url of metadataCandidates(issuer)) {
    const meta = await fetchJson(url);
    if (meta && typeof meta["authorization_endpoint"] === "string" && typeof meta["token_endpoint"] === "string") {
      return { metadata: meta as unknown as AuthServerMetadata, resource, scopes };
    }
  }

  // 3. Last resort: the spec's default endpoints on the issuer origin.
  const origin = new URL(issuer).origin;
  return {
    metadata: {
      issuer,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
    },
    resource,
    scopes,
  };
}

/** Bind a one-shot loopback server; tries the preferred port, then successors. */
function listenLoopback(preferredPort: number): Promise<{ server: http.Server; port: number }> {
  const tryPort = (port: number, remaining: number): Promise<{ server: http.Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = http.createServer();
      server.once("error", (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === "EADDRINUSE" && remaining > 0) {
          resolve(tryPort(port + 1, remaining - 1));
        } else {
          reject(err);
        }
      });
      server.listen(port, "127.0.0.1", () => resolve({ server, port }));
    });
  return tryPort(preferredPort, 10);
}

const CALLBACK_PAGE = (title: string, body: string) => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#121110;color:#DCDAD6">
<div style="text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#8f8b84">${body}</p></div>`;

async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string>,
  clientSecret?: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  if (clientSecret) body.set("client_secret", clientSecret);
  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const desc = json["error_description"] ?? json["error"] ?? `HTTP ${resp.status}`;
    throw new Error(`Token request failed: ${desc}`);
  }
  return json;
}

function tokensFromResponse(json: Record<string, unknown>, previousRefresh?: string) {
  const accessToken = json["access_token"];
  if (typeof accessToken !== "string" || !accessToken) throw new Error("Token response missing access_token");
  const expiresIn = typeof json["expires_in"] === "number" ? json["expires_in"] : undefined;
  return {
    accessToken,
    refreshToken: typeof json["refresh_token"] === "string" ? json["refresh_token"] : previousRefresh,
    expiresAt: expiresIn ? Date.now() / 1000 + expiresIn : undefined,
    scope: typeof json["scope"] === "string" ? json["scope"] : undefined,
  };
}

/**
 * Ensure we have a registered OAuth client for this server; registers
 * dynamically (RFC 7591) when the stored one is missing/expired or was
 * registered for a different redirect URI.
 */
async function ensureClient(
  name: string,
  auth: MCPAuth,
  discovery: OAuthDiscovery,
  redirectUri: string,
  serverUrl: string,
  oauth?: OAuthConfig,
): Promise<{ clientId: string; clientSecret?: string }> {
  // Explicit config wins — for servers without DCR.
  if (oauth?.clientId) return { clientId: oauth.clientId, clientSecret: oauth.clientSecret };

  const entry = await auth.getForUrl(name, serverUrl);
  const stored = entry?.clientInfo;
  if (stored?.clientId && !auth.isClientExpired(entry!) && stored.redirectUris?.includes(redirectUri)) {
    return { clientId: stored.clientId, clientSecret: stored.clientSecret };
  }

  const regEndpoint = discovery.metadata.registration_endpoint;
  if (!regEndpoint) {
    throw new Error(
      "This server doesn't allow apps to sign in automatically — connect with an access token, or add an OAuth client you registered with the service.",
    );
  }
  const resp = await fetch(regEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "AI Studio",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || typeof json["client_id"] !== "string") {
    const desc = json["error_description"] ?? json["error"] ?? `HTTP ${resp.status}`;
    // 401/403 here usually means registration is gated to allowlisted apps
    // (Figma does this) — the token path is the practical way in.
    const hint = resp.status === 401 || resp.status === 403
      ? " — this server restricts which apps may sign in; connect with an access token instead"
      : "";
    throw new Error(`Client registration failed: ${desc}${hint}`);
  }
  const info = {
    clientId: json["client_id"] as string,
    clientSecret: typeof json["client_secret"] === "string" ? (json["client_secret"] as string) : undefined,
    clientIdIssuedAt: typeof json["client_id_issued_at"] === "number" ? (json["client_id_issued_at"] as number) : undefined,
    clientSecretExpiresAt:
      typeof json["client_secret_expires_at"] === "number" && json["client_secret_expires_at"] !== 0
        ? (json["client_secret_expires_at"] as number)
        : undefined,
    redirectUris: [redirectUri],
  };
  await auth.updateClientInfo(name, info, serverUrl);
  return { clientId: info.clientId, clientSecret: info.clientSecret };
}

/**
 * Run the full authorization-code + PKCE flow for a server.
 * Returns the URL to open plus a promise that settles when tokens land.
 */
export async function startAuthFlow(
  name: string,
  serverUrl: string,
  auth: MCPAuth,
  opts?: { oauth?: OAuthConfig; wwwAuthenticate?: string },
): Promise<AuthFlowHandle> {
  const discovery = await discoverOAuth(serverUrl, opts?.wwwAuthenticate);

  const { server, port } = await listenLoopback(opts?.oauth?.callbackPort ?? DEFAULT_CALLBACK_PORT);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  let client: { clientId: string; clientSecret?: string };
  try {
    client = await ensureClient(name, auth, discovery, redirectUri, serverUrl, opts?.oauth);
  } catch (err) {
    server.close();
    throw err;
  }

  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  await auth.setState(name, state);
  await auth.setCodeVerifier(name, verifier);

  const authUrl = new URL(discovery.metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", discovery.resource);
  const scope = opts?.oauth?.scope ?? discovery.scopes?.join(" ");
  if (scope) authUrl.searchParams.set("scope", scope);
  // Google quirk: web-type OAuth clients only issue refresh tokens when
  // offline access is requested explicitly (desktop-type clients always do).
  // Scoped to Google hosts — unknown params can trip other providers.
  if (/(^|\.)google(apis)?\.com$/.test(authUrl.hostname)) {
    authUrl.searchParams.set("access_type", "offline");
  }

  let cancel: () => void = () => {};
  const complete = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Sign-in timed out — try again.")), FLOW_TIMEOUT);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      // One-shot server: drop keep-alive sockets too, or the port lingers
      // and a pooled connection can be reused against a dead server.
      server.close();
      server.closeAllConnections?.();
      if (err) reject(err);
      else resolve();
    };
    cancel = () => finish(new Error("Sign-in cancelled."));

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
        res.end(CALLBACK_PAGE("Sign-in failed", url.searchParams.get("error_description") ?? err));
        finish(new Error(url.searchParams.get("error_description") ?? `Authorization failed: ${err}`));
        return;
      }
      if (!code || gotState !== state) {
        res.writeHead(400, { "Content-Type": "text/html", Connection: "close" });
        res.end(CALLBACK_PAGE("Sign-in failed", "The redirect didn't match this sign-in attempt."));
        finish(new Error("OAuth state mismatch — possible stale or forged callback."));
        return;
      }
      // Exchange before responding, so the page reflects the real outcome.
      tokenRequest(
        discovery.metadata.token_endpoint,
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: client.clientId,
          code_verifier: verifier,
          resource: discovery.resource,
        },
        client.clientSecret,
      )
        .then(async (json) => {
          await auth.updateTokens(name, tokensFromResponse(json), serverUrl);
          await auth.clearCodeVerifier(name);
          res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
          res.end(CALLBACK_PAGE("Connected", "You can close this tab and return to AI Studio."));
          finish();
        })
        .catch((e: Error) => {
          res.writeHead(502, { "Content-Type": "text/html", Connection: "close" });
          res.end(CALLBACK_PAGE("Sign-in failed", e.message));
          finish(e);
        });
    });
  });

  return { url: authUrl.toString(), complete, cancel };
}

/**
 * Silent refresh with the stored refresh token. Returns true when new tokens
 * were stored; false when there's nothing to refresh or the grant failed
 * (caller should fall back to the interactive flow).
 */
export async function refreshTokens(
  name: string,
  serverUrl: string,
  auth: MCPAuth,
  oauth?: OAuthConfig,
): Promise<boolean> {
  const entry = await auth.getForUrl(name, serverUrl);
  const refreshToken = entry?.tokens?.refreshToken;
  if (!refreshToken) return false;
  const clientId = oauth?.clientId ?? entry?.clientInfo?.clientId;
  if (!clientId) return false;
  try {
    const discovery = await discoverOAuth(serverUrl);
    const json = await tokenRequest(
      discovery.metadata.token_endpoint,
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        resource: discovery.resource,
      },
      oauth?.clientSecret ?? entry?.clientInfo?.clientSecret,
    );
    await auth.updateTokens(name, tokensFromResponse(json, refreshToken), serverUrl);
    return true;
  } catch {
    return false;
  }
}
