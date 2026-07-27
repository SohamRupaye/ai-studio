/**
 * Local Claude Code session detection.
 *
 * Squirl deliberately implements NO sign-in for this engine: no OAuth flow, no
 * registered client id, no token storage, no refresh. The user signs into
 * Anthropic's own Claude Code, and the Agent SDK picks up whatever credentials
 * that wrote. This module only answers "does a local login appear to exist",
 * so the settings row can say so.
 *
 * Hard rule for everything in this file: never read, log, return, or pass
 * around a credential VALUE. Existence and key-presence checks only. In
 * particular, never invoke `security find-generic-password` with `-g` — that
 * flag prints the secret to stdout.
 *
 * This is a heuristic for UI purposes. The authoritative answer arrives at
 * runtime on the SDK's `system`/`init` message as `apiKeySource`, which the
 * engine checks (see claude-sdk.ts) — a machine can hold a stale credential
 * file that no longer authenticates.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SessionSignal =
  | "claude-json-oauth-account"
  | "credentials-file"
  | "keychain"
  | "none";

export interface LocalClaudeSession {
  /** A local Claude Code login appears to exist. */
  signedIn: boolean;
  /** Which signal decided it — surfaced in the settings hint and bug reports. */
  detectedVia: SessionSignal;
  /**
   * `ANTHROPIC_API_KEY` is set in this process's environment. The engine strips
   * it from the SDK subprocess so subscription auth is what actually runs;
   * surfaced so the UI can explain why a key present on the machine isn't the
   * thing being billed.
   */
  apiKeyInEnv: boolean;
}

/**
 * `~/.claude.json` carries an `oauthAccount` object once Claude Code has been
 * signed into. Only key presence is tested — no value is read or returned.
 */
function hasOauthAccount(): boolean {
  const path = join(homedir(), ".claude.json");
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return "oauthAccount" in parsed;
  } catch {
    // Unparseable or unreadable — treat as no signal rather than throwing into
    // the settings IPC handler.
    return false;
  }
}

/**
 * Some platforms store credentials in a file rather than an OS keyring. Tested
 * for existence ONLY and never parsed — this file holds live tokens.
 */
function hasCredentialsFile(): boolean {
  return existsSync(join(homedir(), ".claude", ".credentials.json"));
}

/**
 * macOS keeps the credential in the login keychain. Exit code only: no `-g`,
 * so the secret is never printed, and stdio is discarded regardless.
 */
function hasKeychainEntry(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const res = spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], {
      stdio: "ignore",
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function detectLocalClaudeSession(): LocalClaudeSession {
  const apiKeyInEnv = Boolean(process.env["ANTHROPIC_API_KEY"]);
  for (const [signal, probe] of [
    ["claude-json-oauth-account", hasOauthAccount],
    ["credentials-file", hasCredentialsFile],
    ["keychain", hasKeychainEntry],
  ] as Array<[SessionSignal, () => boolean]>) {
    if (probe()) return { signedIn: true, detectedVia: signal, apiKeyInEnv };
  }
  return { signedIn: false, detectedVia: "none", apiKeyInEnv };
}
