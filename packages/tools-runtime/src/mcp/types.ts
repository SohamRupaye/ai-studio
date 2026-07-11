/**
 * MCP Types - Multi-transport MCP client types
 */

export type MCPTransport = "stdio" | "sse" | "http";

export type MCPStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth"; url?: string }
  | { status: "reconnecting"; attempt: number };

export interface MCPServerConfig {
  name: string;
  type: MCPTransport;
  enabled?: boolean;
  timeout?: number;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // http/sse
  url?: string;
  headers?: Record<string, string>;
  // oauth
  oauth?: OAuthConfig;
}

export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  redirectUri?: string;
  callbackPort?: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface OAuthClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  /** Redirect URIs this client was registered with — a flow may only reuse
   * the stored registration when its loopback URI matches one of these. */
  redirectUris?: string[];
}

export interface OAuthEntry {
  tokens?: OAuthTokens;
  clientInfo?: OAuthClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface MCPResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
}
