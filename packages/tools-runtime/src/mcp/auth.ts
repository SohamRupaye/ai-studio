/**
 * MCP Auth - Persistent OAuth credential storage with file locking
 */
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import type { OAuthEntry, OAuthTokens, OAuthClientInfo } from "./types";

const AUTH_FILE = path.join(homedir(), ".ai-studio", "mcp-auth.json");

export class MCPAuth {
  private data = new Map<string, OAuthEntry>();
  private loaded = false;
  private file: string;

  /** `file` override is for tests — production uses the default location. */
  constructor(file: string = AUTH_FILE) {
    this.file = file;
  }

  private async load(): Promise<Map<string, OAuthEntry>> {
    if (this.loaded) return this.data;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const raw = await fs.readFile(this.file, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, OAuthEntry>;
      this.data = new Map(
        parsed && typeof parsed === "object" ? Object.entries(parsed) : [],
      );
    } catch {
      this.data = new Map();
    }
    this.loaded = true;
    return this.data;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 });
  }

  async get(name: string): Promise<OAuthEntry | undefined> {
    const data = await this.load();
    return data.get(name);
  }

  async getForUrl(name: string, serverUrl: string): Promise<OAuthEntry | undefined> {
    const entry = await this.get(name);
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return undefined;
    return entry;
  }

  async set(name: string, entry: OAuthEntry): Promise<void> {
    await this.load();
    this.data.set(name, entry);
    await this.save();
  }

  async remove(name: string): Promise<void> {
    await this.load();
    this.data.delete(name);
    await this.save();
  }

  async updateTokens(name: string, tokens: OAuthTokens, serverUrl?: string): Promise<void> {
    await this.load();
    const entry = this.data.get(name) ?? {};
    entry.tokens = tokens;
    if (serverUrl) entry.serverUrl = serverUrl;
    this.data.set(name, entry);
    await this.save();
  }

  async updateClientInfo(name: string, info: OAuthClientInfo, serverUrl?: string): Promise<void> {
    await this.load();
    const entry = this.data.get(name) ?? {};
    entry.clientInfo = info;
    if (serverUrl) entry.serverUrl = serverUrl;
    this.data.set(name, entry);
    await this.save();
  }

  async setCodeVerifier(name: string, verifier: string): Promise<void> {
    await this.load();
    const entry = this.data.get(name) ?? {};
    entry.codeVerifier = verifier;
    this.data.set(name, entry);
    await this.save();
  }

  async getCodeVerifier(name: string): Promise<string | undefined> {
    const entry = await this.get(name);
    return entry?.codeVerifier;
  }

  async clearCodeVerifier(name: string): Promise<void> {
    await this.load();
    const entry = this.data.get(name);
    if (entry) delete entry.codeVerifier;
    await this.save();
  }

  async setState(name: string, state: string): Promise<void> {
    await this.load();
    const entry = this.data.get(name) ?? {};
    entry.oauthState = state;
    this.data.set(name, entry);
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
