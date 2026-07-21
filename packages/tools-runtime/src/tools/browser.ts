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

// The window closes itself after this long without a browser tool running —
// the agent's window shouldn't linger once the task is done, and the user
// shouldn't have to ask for cleanup. (Their own Chrome is a separate
// process/profile and is never touched.)
const IDLE_CLOSE_MS = 5 * 60_000;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;

function closeContext() {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (_ctx) { _ctx.close().catch(() => {}); _ctx = null; }
}

function touchIdle() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(closeContext, IDLE_CLOSE_MS);
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
  // The user can close the window themselves — without this, the next tool
  // call would try to reuse a dead context and error.
  (_ctx as any).on?.("close", () => {
    _ctx = null;
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  });
  return _ctx!;
}

async function page(): Promise<any> {
  touchIdle();
  const ctx = await context();
  const open = ctx.pages().find((p: any) => !p.isClosed());
  return open ?? (await ctx.newPage());
}

// ── Activity banner ──────────────────────────────────────────────────────────
// A small in-page pill telling the user the agent is driving this window.
// aria-hidden (excluded from browser_snapshot) + pointer-events:none (blocks
// neither the user nor the agent's clicks); fades out ~6s after the last
// tool touch. Best-effort — a strict CSP or mid-navigation evaluate just
// skips it. browser_text hides it during reads so it can't leak into results.

const BANNER_ID = "__squirl-agent-banner";

async function showActivityBanner(p: any) {
  try {
    await p.evaluate((id: string) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("aria-hidden", "true");
        el.style.cssText =
          "position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;" +
          "padding:9px 14px;border-radius:999px;background:rgba(18,17,16,.92);color:#DCDAD6;" +
          "font:500 12.5px/1 -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
          "pointer-events:none;transition:opacity .3s ease;";
        const style = document.createElement("style");
        style.textContent = "@keyframes __squirl-pulse{0%,100%{opacity:.35}50%{opacity:1}}";
        const dot = document.createElement("span");
        dot.style.cssText =
          "width:7px;height:7px;border-radius:50%;background:#E8A33D;animation:__squirl-pulse 1.2s ease-in-out infinite;";
        el.append(style, dot, document.createTextNode("Squirl is working in this window"));
        document.documentElement.appendChild(el);
      }
      el.style.display = "flex";
      el.style.opacity = "1";
      const w = window as unknown as { __squirlBannerTimer?: number };
      if (w.__squirlBannerTimer) clearTimeout(w.__squirlBannerTimer);
      w.__squirlBannerTimer = window.setTimeout(() => { el!.style.opacity = "0"; }, 6000);
    }, BANNER_ID);
  } catch { /* navigating page / strict CSP — the banner is cosmetic */ }
}

async function hideActivityBanner(p: any) {
  try {
    await p.evaluate((id: string) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }, BANNER_ID);
  } catch { /* same best-effort contract as show */ }
}

/** Resolve an aria-snapshot ref (e2, @e2, [ref=e2]) to a Patchright selector;
 * anything else is passed through as a CSS/text selector. */
function selectorFor(input: string): string {
  const t = input.trim();
  const m = t.match(/^\[ref=([^\]]+)\]$/) ?? t.match(/^@?(e\d+)$/) ?? t.match(/^ref=(\S+)$/);
  return m ? `aria-ref=${m[1]}` : t;
}

const FALLBACK_NOTE =
  "This runs in the user's OWN persistent, already-logged-in Chrome — not a scraper hitting a stranger's login wall. Sites that would show a login prompt to a fresh/anonymous request (LinkedIn and other social/professional profiles, dashboards behind SSO, etc.) load and read normally here, the same as if the user opened them personally, as long as the user is signed in in this window. Treat that as the ordinary case, not an exception to hedge about — reach for this over web_fetch/web_search whenever the target needs a real signed-in session or JavaScript rendering, or blocks ordinary automation.";

export const browserOpenDef: ToolDefinition = {
  id: "browser_open",
  description: `Open (or reuse) the local Chrome window and navigate to a URL. Just navigate and read the result — don't preface it with disclaimers about whether the page will be reachable, and don't ask the user what to do if it's blocked before you've actually tried. Only report a problem once you've seen one (an explicit login/verification wall in a browser_snapshot, a failed load) — not before. Reuse what you already know: if an earlier step in this conversation (your own browser_snapshot/browser_text result, or your own prior reply) already gave you a specific URL for what's being asked about — a profile link, a search-results page — navigate straight to THAT URL. Don't restart from a site's homepage or a generic search when you already have the exact page. And once you've opened a page here, read it with browser_snapshot/browser_text (browser_scroll first if the content isn't visible yet) — don't answer a follow-up about a page you just opened in this browser by switching to web_search/web_fetch instead; that silently abandons the live, logged-in session the user explicitly asked you to use. If the site supports URL-based search (e.g. "?q=", "?keywords="), prefer building that URL directly over clicking into an on-page search box — search inputs are often scoped to whatever page you're already on (a site's Jobs page has its own local search, not the site's global one), and it's easy to fill the wrong one without noticing. ${FALLBACK_NOTE}`,
  parameters: { type: "object", properties: { url: { type: "string", description: "URL to open (include the scheme)." } }, required: ["url"] },
};
export const browserOpen: ToolHandler = async (args) => {
  const url = String(args["url"] ?? "");
  const p = await page();
  await p.goto(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await showActivityBanner(p);
  return `Opened ${p.url()}`;
};

export const browserSnapshotDef: ToolDefinition = {
  id: "browser_snapshot",
  description: "Return an accessibility snapshot of the current page with element refs like [ref=e2]. Call this before click/fill to find elements, and again after a failed click/fill (the page — or the search scope you're on — may not be what you assumed) instead of guessing or asking the user.",
  parameters: { type: "object", properties: {}, required: [] },
};
export const browserSnapshot: ToolHandler = async () => {
  const p = await page();
  await showActivityBanner(p); // aria-hidden — never appears in the snapshot
  const snap = (await p.ariaSnapshot({ mode: "ai" })) || "(empty page)";
  return `URL: ${p.url()}\n\n${snap}`;
};

export const browserClickDef: ToolDefinition = {
  id: "browser_click",
  description: "Click an element. Pass an aria snapshot ref (e2, @e2, [ref=e2]) or a CSS/text selector. If it fails, take a fresh browser_snapshot before retrying or asking the user — a failure usually means you're not on the page you think you are, not that the request was ambiguous.",
  parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
};
export const browserClick: ToolHandler = async (args) => {
  const selector = String(args["selector"] ?? "");
  const p = await page();
  await showActivityBanner(p);
  await p.locator(selectorFor(selector)).first().click({ timeout: 10_000 });
  return `Clicked ${selector} (now on ${p.url()})`;
};

export const browserFillDef: ToolDefinition = {
  id: "browser_fill",
  description: "Type text into an input. Pass an aria snapshot ref or CSS/text selector. If it fails, take a fresh browser_snapshot before retrying or asking the user — a failure usually means you're not on the page you think you are (e.g. a page-local search box instead of the site's global one), not that the request was ambiguous.",
  parameters: {
    type: "object",
    properties: { selector: { type: "string" }, text: { type: "string" } },
    required: ["selector", "text"],
  },
};
export const browserFill: ToolHandler = async (args) => {
  const selector = String(args["selector"] ?? "");
  const p = await page();
  await showActivityBanner(p);
  await p.locator(selectorFor(selector)).first().fill(String(args["text"] ?? ""), { timeout: 10_000 });
  return `Filled ${selector} (on ${p.url()})`;
};

export const browserPressDef: ToolDefinition = {
  id: "browser_press",
  description: "Press a keyboard key on the current page (e.g. \"Enter\", \"Escape\", \"Control+A\"). Do NOT use this to scroll (PageDown/End/Space) — keyboard scrolling only works if focus happens to be on a scrollable element, which is unreliable right after a click, and silently does nothing otherwise. Use browser_scroll instead.",
  parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
};
export const browserPress: ToolHandler = async (args) => {
  const key = String(args["key"] ?? "");
  const p = await page();
  await showActivityBanner(p);
  await p.keyboard.press(key);
  return `Pressed ${key}`;
};

export const browserScrollDef: ToolDefinition = {
  id: "browser_scroll",
  description: "Scroll the page with a real scroll event, regardless of keyboard focus — needed for sites that lazy-load more content as you scroll (most social/professional profile pages do). Returns whether the page actually moved; if it didn't, you're likely already at that end, or the content lives in a different scrollable container (check browser_snapshot).",
  parameters: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["down", "up", "top", "bottom"], description: "down/up move about one viewport; top/bottom jump to the very start/end." },
      amount: { type: "number", description: "Optional pixel override for down/up (default: ~85% of one viewport height)." },
    },
    required: ["direction"],
  },
};
export const browserScroll: ToolHandler = async (args) => {
  const direction = String(args["direction"] ?? "down");
  const p = await page();
  await showActivityBanner(p);
  const before: number = await p.evaluate(() => window.scrollY);
  if (direction === "top") {
    await p.evaluate(() => window.scrollTo(0, 0));
  } else if (direction === "bottom") {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } else {
    const viewportHeight: number = await p.evaluate(() => window.innerHeight);
    const viewportWidth: number = await p.evaluate(() => window.innerWidth);
    const amount = Number(args["amount"]) || viewportHeight * 0.85;
    // A real wheel event (not window.scrollBy) so scroll/IntersectionObserver
    // listeners gating lazy-loaded content fire the same as a user scrolling —
    // and it works no matter where keyboard focus landed.
    await p.mouse.move(viewportWidth / 2, viewportHeight / 2);
    await p.mouse.wheel(0, direction === "up" ? -amount : amount);
  }
  await p.waitForTimeout(300); // let lazy content/observers settle before reading back
  const after: number = await p.evaluate(() => window.scrollY);
  if (after === before) {
    return `No movement — already at the ${direction === "up" || direction === "top" ? "top" : "bottom"}, or this page scrolls a different container than the window (try browser_snapshot to look for one).`;
  }
  return `Scrolled ${direction}: page position ${before} → ${after}.`;
};

export const browserTextDef: ToolDefinition = {
  id: "browser_text",
  description: "Read visible text. With a selector, returns that element's text; without, the whole page body. If content you expect isn't there yet, browser_scroll first — many pages only render more on scroll.",
  parameters: { type: "object", properties: { selector: { type: "string", description: "Optional element selector or aria ref." } }, required: [] },
};
export const browserText: ToolHandler = async (args) => {
  const selector = args["selector"] ? String(args["selector"]) : "body";
  const p = await page();
  // Hidden during the read so the banner's own text can't leak into a
  // whole-body innerText result; re-shown after.
  await hideActivityBanner(p);
  const text = (await p.locator(selectorFor(selector)).first().innerText({ timeout: 10_000 })) || "(no text)";
  await showActivityBanner(p);
  return `URL: ${p.url()}\n\n${text}`;
};

export const browserCloseDef: ToolDefinition = {
  id: "browser_close",
  description:
    "Close the local browser window. It also closes itself after a few minutes of inactivity — call this when you're done with it or the user asks.",
  parameters: { type: "object", properties: {}, required: [] },
};
export const browserClose: ToolHandler = async () => {
  closeContext();
  return "Closed the local browser.";
};

const BROWSER_TOOL_IDS = [
  "browser_open", "browser_snapshot", "browser_click", "browser_fill",
  "browser_press", "browser_scroll", "browser_text", "browser_close",
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
  reg.register(browserScrollDef, browserScroll);
  reg.register(browserTextDef, browserText);
  reg.register(browserCloseDef, browserClose);
}

/** Remove the local-browser tools (disabling mid-session) and close any window. */
export function unregisterBrowserTools(reg: { unregister: (id: string) => void }) {
  for (const id of BROWSER_TOOL_IDS) reg.unregister(id);
  closeContext();
}

/** True while the local browser context is live (window open). */
export function isBrowserOpen(): boolean {
  return _ctx !== null;
}
