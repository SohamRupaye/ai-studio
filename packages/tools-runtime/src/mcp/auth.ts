/**
 * MCP Auth - Persistent OAuth credential storage with file locking
 */
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import type { OAuthEntry, OAuthTokens, OAuthClientInfo } from "./types";

const AUTH_FILE = path.join(homedir(), ".ai-studio", "mcp-auth.json");

export class MCPAuth {
  private data: Record<string, OAuthEntry> = {};
  private loaded = false;

  private async load(): Promise<Record<string, OAuthEntry>> {
    if (this.loaded) return this.data;
    try {
      await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
      const raw = await fs.readFile(AUTH_FILE, "utf-8");
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
    this.loaded = true;
    return this.data;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await fs.writeFile(AUTH_FILE, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  async get(name: string): Promise<OAuthEntry | undefined> {
    const data = await this.load();
    return data[name];
  }

  async getForUrl(name: string, serverUrl: string): Promise<OAuthEntry | undefined> {
    const entry = await this.get(name);
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return undefined;
    return entry;
  }

  async set(name: string, entry: OAuthEntry): Promise<void> {
    await this.load();
    this.data[name] = entry;
    await this.save();
  }

  async remove(name: string): Promise<void> {
    await this.load();
    delete this.data[name];
    await this.save();
  }

  async updateTokens(name: string, tokens: OAuthTokens, serverUrl?: string): Promise<void> {
    await this.load();
    const entry = this.data[name] ?? {};
    entry.tokens = tokens;
    if (serverUrl) entry.serverUrl = serverUrl;
    this.data[name] = entry;
    await this.save();
  }

  async updateClientInfo(name: string, info: OAuthClientInfo, serverUrl?: string): Promise<void> {
    await this.load();
    const entry = this.data[name] ?? {};
    entry.clientInfo = info;
    if (serverUrl) entry.serverUrl = serverUrl;
    this.data[name] = entry;
    await this.save();
  }

  async setCodeVerifier(name: string, verifier: string): Promise<void> {
    await this.load();
    const entry = this.data[name] ?? {};
    entry.codeVerifier = verifier;
    this.data[name] = entry;
    await this.save();
  }

  async getCodeVerifier(name: string): Promise<string | undefined> {
    const entry = await this.get(name);
    return entry?.codeVerifier;
  }

  async clearCodeVerifier(name: string): Promise<void> {
    await this.load();
    const entry = this.data[name];
    if (entry) delete entry.codeVerifier;
    await this.save();
  }

  async setState(name: string, state: string): Promise<void> {
    await this.load();
    const entry = this.data[name] ?? {};
    entry.oauthState = state;
    this.data[name] = entry;
    await this.save();
  }

  async getState(name: string): Promise<string | undefined> {
    const entry = await this.get(name);
    return entry?.oauthState;
  }

  isTokenExpired(entry: OAuthEntry): boolean | null {
    if (!entry.tokens) return null;
    if (!entry.tokens.expiresAt) return false;
    return entry.tokens.expiresAt < Date.now() / 1000;
  }

  isClientExpired(entry: OAuthEntry): boolean {
    if (!entry.clientInfo?.clientSecretExpiresAt) return false;
    return entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000;
  }
}
