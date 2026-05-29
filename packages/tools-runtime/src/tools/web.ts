/**
 * web.ts — Web tools: search and fetch as separate, distinct operations.
 *
 * web_search  — "find me relevant pages for this query"
 * web_fetch   — "read the content of this exact URL"
 *
 * Search backends (cascade): Exa.ai → Parallel.ai → DuckDuckGo
 * Fetch backends (cascade): Direct HTTP → Readability-style extraction
 */

import { request as nodeHttpRequest } from "node:http";
import { request as nodeHttpsRequest } from "node:https";
import { URL } from "node:url";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── MCP helper (shared by search backends) ────────────────────────────────────

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";
const MCP_HEADERS = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };

async function callMCP(url: string, tool: string, args: Record<string, unknown>, timeout = 15_000): Promise<string | null> {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const text = await res.text();
    if (text.trim().startsWith("{")) {
      const data = JSON.parse(text);
      const content = data.result?.content || [];
      for (const item of content) { if (item.text) return item.text; }
    }
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload.startsWith("{")) continue;
      try {
        const data = JSON.parse(payload);
        const content = data.result?.content || [];
        for (const item of content) { if (item.text) return item.text; }
      } catch { continue; }
    }
    return null;
  } catch { return null; }
}

// ── Search backends ───────────────────────────────────────────────────────────

async function searchExa(query: string, numResults: number): Promise<string | null> {
  return callMCP(EXA_MCP_URL, "web_search_exa", { query, numResults });
}

async function searchParallel(query: string): Promise<string | null> {
  return callMCP(PARALLEL_MCP_URL, "web_search", { query }, 20_000);
}

async function searchDDG(query: string, numResults: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      body: `q=${encodeURIComponent(query)}&b=`,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();

    const titles = [...html.matchAll(/class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)];
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>(.*?)<\/[at]>/gs)];
    if (!titles.length) return null;

    const lines: string[] = [];
    for (let i = 0; i < Math.min(titles.length, numResults); i++) {
      const title = titles[i]![2]!.replace(/<[^>]+>/g, "").trim();
      const snippet = snippets[i] ? snippets[i]![1]!.replace(/<[^>]+>/g, "").trim() : "";
      lines.push(`${i + 1}. ${title}`);
      if (snippet) lines.push(`   ${snippet}`);
      lines.push("");
    }
    return lines.join("\n").trim() || null;
  } catch { return null; }
}

// ── Fetch backend — raw HTTP using Node built-ins ─────────────────────────────

function rawFetch(url: string, timeoutMs: number): Promise<{ body: string; contentType: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requester = parsed.protocol === "https:" ? nodeHttpsRequest : nodeHttpRequest;

    const req = requester(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      } as any,
      (res: any) => {
        // Handle redirects (up to 3)
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          try {
            const redirectUrl = new URL(res.headers.location, url).toString();
            rawFetch(redirectUrl, timeoutMs).then(resolve).catch(reject);
          } catch { reject(new Error(`Redirect failed: ${res.headers.location}`)); }
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({
          body: Buffer.concat(chunks).toString("utf-8"),
          contentType: (res.headers["content-type"] || "") as string,
          status: res.statusCode || 0,
        }));
      }
    );

    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.end();
  });
}

// ── HTML → readable text conversion ──────────────────────────────────────────
// No external libraries — pure regex extraction with article heuristics.

function htmlToText(html: string, url: string): string {
  // Remove noise blocks first
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Try to extract main content block (article/main/[role=main])
  const contentMatch =
    html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i) ||
    html.match(/role="main"[\s\S]*?>([\s\S]*?)<\/[a-z]+>/i);

  if (contentMatch) {
    text = contentMatch[1]!
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
  }

  // Convert headings to markdown-style
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n#### $1\n");

  // Convert links and code
  text = text
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n• $1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1")
    .replace(/<[^>]+>/g, ""); // strip remaining tags

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)));

  // Collapse whitespace
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.replace(/<[^>]+>/g, "").trim() : "";
}

// ── Tool: web_search ──────────────────────────────────────────────────────────

export const webSearchDef: ToolDefinition = {
  name: "web_search",
  description: "Search the web for relevant pages matching a query. Returns a list of results (titles, URLs, snippets). Use this when you need to FIND information or pages — not when you already have a URL to read. Backends: Exa.ai → Parallel.ai → DuckDuckGo.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      num_results: { type: "number", description: "Number of results to return (default: 5)" },
    },
    required: ["query"],
  },
};

export const webSearch: ToolHandler = async (args) => {
  const query = args["query"] as string;
  const numResults = (args["num_results"] as number) || 5;

  const exa = await searchExa(query, numResults);
  if (exa) return exa;

  const parallel = await searchParallel(query);
  if (parallel) return parallel;

  const ddg = await searchDDG(query, numResults);
  if (ddg) return ddg;

  return "No results found.";
};

// ── Tool: web_fetch ───────────────────────────────────────────────────────────

export const webFetchDef: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch and read the full content of a specific URL. Use this when you already have a URL and want to read its contents — documentation pages, GitHub files, API responses, articles. Returns readable text extracted from the page. Do NOT use this to search — use web_search for that.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL to fetch (must include https:// or http://)" },
      max_chars: { type: "number", description: "Maximum characters to return (default: 12000)" },
      raw: { type: "boolean", description: "Return raw text without HTML-to-text conversion (useful for JSON/plain-text endpoints)" },
    },
    required: ["url"],
  },
};

export const webFetch: ToolHandler = async (args) => {
  const url = args["url"] as string;
  const maxChars = (args["max_chars"] as number) || 12_000;
  const raw = args["raw"] as boolean | undefined;

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Invalid URL protocol: ${parsed.protocol}. Only http:// and https:// are supported.`;
    }
  } catch {
    return `Invalid URL: ${url}`;
  }

  let body: string;
  let contentType: string;
  let status: number;

  try {
    ({ body, contentType, status } = await rawFetch(url, 20_000));
  } catch (e: any) {
    // Try Exa content API as fallback (works for JS-heavy pages)
    const exaContent = await callMCP(EXA_MCP_URL, "get_contents", { urls: [url] }, 15_000);
    if (exaContent) return exaContent.slice(0, maxChars);
    return `Fetch failed: ${e.message}\nURL: ${url}`;
  }

  if (status >= 400) {
    return `HTTP ${status} for ${url}`;
  }

  // JSON response — return pretty-printed
  if (contentType.includes("application/json") || (body.trimStart()[0] === "{" || body.trimStart()[0] === "[")) {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2).slice(0, maxChars);
    } catch {}
  }

  // Plain text, Markdown, CSV — return as-is
  if (!contentType.includes("text/html") || raw) {
    return body.slice(0, maxChars);
  }

  // HTML — extract readable content
  const title = extractTitle(body);
  const text = htmlToText(body, url);
  const header = title ? `# ${title}\nSource: ${url}\n\n` : `Source: ${url}\n\n`;

  return (header + text).slice(0, maxChars);
};
