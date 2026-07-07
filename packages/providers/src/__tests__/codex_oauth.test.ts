import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

// In-memory fake filesystem so tests never touch the real ~/.ai-studio/auth.json.
const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  },
  writeFileSync: (path: string, data: string) => { files.set(path, data); },
  mkdirSync: () => {},
  unlinkSync: (path: string) => { files.delete(path); },
}));

describe("CodexOAuthProvider account management", () => {
  beforeEach(() => {
    files.clear();
    vi.resetModules();
  });

  it("reports disconnected when no auth file exists", async () => {
    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    const provider = new CodexOAuthProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getStatus()).toEqual({ connected: false });
  });

  it("reports connected account details when auth file exists", async () => {
    const authPath = join(homedir(), ".ai-studio", "auth.json");
    files.set(authPath, JSON.stringify({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 3600_000,
      account_id: "acct_123",
      email: "user@example.com",
    }));

    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    const provider = new CodexOAuthProvider();
    expect(provider.isAvailable()).toBe(true);
    expect(provider.getStatus()).toEqual({
      connected: true,
      accountId: "acct_123",
      email: "user@example.com",
    });
  });

  it("logout clears in-memory auth and deletes the auth file", async () => {
    const authPath = join(homedir(), ".ai-studio", "auth.json");
    files.set(authPath, JSON.stringify({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 3600_000,
      account_id: "acct_123",
      email: "user@example.com",
    }));

    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    const provider = new CodexOAuthProvider();
    expect(provider.isAvailable()).toBe(true);

    provider.logout();

    expect(provider.isAvailable()).toBe(false);
    expect(provider.getStatus()).toEqual({ connected: false });
    expect(files.has(authPath)).toBe(false);
  });

  it("logout is a no-op when already disconnected", async () => {
    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    const provider = new CodexOAuthProvider();
    expect(() => provider.logout()).not.toThrow();
    expect(provider.getStatus()).toEqual({ connected: false });
  });
});
