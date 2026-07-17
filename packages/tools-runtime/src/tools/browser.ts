/**
 * Local browser tools — a Patchright-driven Chrome using the user's own
 * persistent profile, so the agent can act on logged-in / JS-heavy /
 * bot-walled pages that web_fetch can't touch. Opt-in (config
 * browserToolEnabled); registered only when enabled. Adapted from
 * raroque/boop-agent's server/browser (MIT).
 *
 * Deliberately headed and persistent: the whole point is reusing sessions the
 * user logged into once. patchright is an optionalDependency, lazy-imported so
 * a machine without it (or the browser binary) only errors when a tool runs.
 */
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition, ToolHandler } from "../registry.js";

// Set by the desktop app so the profile lives under userData, not cwd.
let _profileDir = "";
export function setBrowserProfileDir(dir: string) {
  _profileDir = dir;
}

// patchright's types aren't available at build (optional dep) — keep it loose.
type AnyContext = { pages(): any[]; newPage(): Promise<any>; close(): Promise<void> };
let _ctx: AnyContext | null = null;
let _importPromise: Promise<any> | null = null;

async function loadPatchright(): Promise<any> {
  _importPromise ??= import("patchright").catch((err) => {
    _importPromise = null;
    throw new Error(
      `Local browser is unavailable: patchright isn't installed. Reinstall the app's optional dependencies. (${err instanceof Error ? err.message : String(err)})`,
    );
  });
  return _importPromise;
}

async function context(): Promise<AnyContext> {
  if (_ctx) return _ctx;
  const { chromium } = await loadPatchright();
  const profileDir = resolve(_profileDir || "./browser-profile");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  try { chmodSync(profileDir, 0o700); } catch { /* best-effort */ }
  _ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    channel: "chrome",
  });
  return _ctx!;
}

async function page(): Promise<any> {
  const ctx = await context();
  const open = ctx.pages().find((p: any) => !p.isClosed());
  return open ?? (await ctx.newPage());
}

/** Resolve an aria-snapshot ref (e2, @e2, [ref=e2]) to a Patchright selector;
 * anything else is passed through as a CSS/text selector. */
function selectorFor(input: string): string {
  const t = input.trim();
  const m = t.match(/^\[ref=([^\]]+)\]$/) ?? t.match(/^@?(e\d+)$/) ?? t.match(/^ref=(\S+)$/);
  return m ? `aria-ref=${m[1]}` : t;
}

const FALLBACK_NOTE =
  "Use this only when web_fetch or a connected integration can't do the job — a page needing a real logged-in browser, JavaScript rendering, or that blocks ordinary automation. A visible Chrome window opens on the user's machine using their own profile.";

export const browserOpenDef: ToolDefinition = {
  id: "browser_open",
  description: `Open (or reuse) the local Chrome window and navigate to a URL. ${FALLBACK_NOTE}`,
  parameters: { type: "object", properties: { url: { type: "string", description: "URL to open (include the scheme)." } }, required: ["url"] },
};
export const browserOpen: ToolHandler = async (args) => {
  const url = String(args["url"] ?? "");
  const p = await page();
  await p.goto(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return `Opened ${p.url()}`;
};

export const browserSnapshotDef: ToolDefinition = {
  id: "browser_snapshot",
  description: "Return an accessibility snapshot of the current page with element refs like [ref=e2]. Call this before click/fill to find elements.",
  parameters: { type: "object", properties: {}, required: [] },
};
export const browserSnapshot: ToolHandler = async () => {
  const p = await page();
  return (await p.ariaSnapshot({ mode: "ai" })) || "(empty page)";
};

export const browserClickDef: ToolDefinition = {
  id: "browser_click",
  description: "Click an element. Pass an aria snapshot ref (e2, @e2, [ref=e2]) or a CSS/text selector.",
  parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
};
export const browserClick: ToolHandler = async (args) => {
  const selector = String(args["selector"] ?? "");
  const p = await page();
  await p.locator(selectorFor(selector)).first().click({ timeout: 10_000 });
  return `Clicked ${selector}`;
};

export const browserFillDef: ToolDefinition = {
  id: "browser_fill",
  description: "Type text into an input. Pass an aria snapshot ref or CSS/text selector.",
  parameters: {
    type: "object",
    properties: { selector: { type: "string" }, text: { type: "string" } },
    required: ["selector", "text"],
  },
};
export const browserFill: ToolHandler = async (args) => {
  const selector = String(args["selector"] ?? "");
  const p = await page();
  await p.locator(selectorFor(selector)).first().fill(String(args["text"] ?? ""), { timeout: 10_000 });
  return `Filled ${selector}`;
};

export const browserPressDef: ToolDefinition = {
  id: "browser_press",
  description: "Press a keyboard key on the current page (e.g. \"Enter\", \"Escape\", \"Control+A\").",
  parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
};
export const browserPress: ToolHandler = async (args) => {
  const key = String(args["key"] ?? "");
  const p = await page();
  await p.keyboard.press(key);
  return `Pressed ${key}`;
};

export const browserTextDef: ToolDefinition = {
  id: "browser_text",
  description: "Read visible text. With a selector, returns that element's text; without, the whole page body.",
  parameters: { type: "object", properties: { selector: { type: "string", description: "Optional element selector or aria ref." } }, required: [] },
};
export const browserText: ToolHandler = async (args) => {
  const selector = args["selector"] ? String(args["selector"]) : "body";
  const p = await page();
  return (await p.locator(selectorFor(selector)).first().innerText({ timeout: 10_000 })) || "(no text)";
};

export const browserCloseDef: ToolDefinition = {
  id: "browser_close",
  description: "Close the local browser window and its context.",
  parameters: { type: "object", properties: {}, required: [] },
};
export const browserClose: ToolHandler = async () => {
  if (_ctx) { await _ctx.close().catch(() => {}); _ctx = null; }
  return "Closed the local browser.";
};

const BROWSER_TOOL_IDS = [
  "browser_open", "browser_snapshot", "browser_click",
  "browser_fill", "browser_press", "browser_text", "browser_close",
] as const;

/** The tool ids these tools register — used by the desktop app to redact the
 * typed value of browser_fill from persisted tool-call detail. */
export const BROWSER_FILL_TOOL_ID = "browser_fill";

/** Register the local-browser tools into a registry (call only when enabled). */
export function registerBrowserTools(reg: { register: (def: ToolDefinition, handler: ToolHandler) => void }) {
  reg.register(browserOpenDef, browserOpen);
  reg.register(browserSnapshotDef, browserSnapshot);
  reg.register(browserClickDef, browserClick);
  reg.register(browserFillDef, browserFill);
  reg.register(browserPressDef, browserPress);
  reg.register(browserTextDef, browserText);
  reg.register(browserCloseDef, browserClose);
}

/** Remove the local-browser tools (disabling mid-session) and close any window. */
export function unregisterBrowserTools(reg: { unregister: (id: string) => void }) {
  for (const id of BROWSER_TOOL_IDS) reg.unregister(id);
  if (_ctx) { _ctx.close().catch(() => {}); _ctx = null; }
}

/** True while the local browser context is live (window open). */
export function isBrowserOpen(): boolean {
  return _ctx !== null;
}
