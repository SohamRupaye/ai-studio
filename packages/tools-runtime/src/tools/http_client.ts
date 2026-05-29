/**
 * http_client.ts — Structured HTTP client for API/backend testing.
 * Supports: GET/POST/PUT/PATCH/DELETE, JSON bodies, auth headers,
 * response formatting, and cURL command generation for debugging.
 * Uses only Node.js built-ins (no fetch polyfill needed in Node 20+).
 */

import { request as nodeHttpRequest } from "node:http";
import { request as nodeHttpsRequest } from "node:https";
import { URL } from "node:url";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Core HTTP function ────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

function doRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const requester = isHttps ? nodeHttpsRequest : nodeHttpRequest;

    const startTime = Date.now();
    const bodyBuf = body ? Buffer.from(body, "utf-8") : undefined;

    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        "User-Agent": "ai-studio-http-client/1.0",
        ...(bodyBuf ? { "Content-Length": String(bodyBuf.byteLength) } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = requester(options as any, (res: any) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          headers: res.headers as Record<string, string>,
          body: rawBody,
          duration: Date.now() - startTime,
        });
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error(`Request timed out after ${timeoutMs}ms`)); });
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function formatResponse(resp: HttpResponse, pretty: boolean): string {
  const statusIcon = resp.status >= 200 && resp.status < 300 ? "✅" :
    resp.status >= 400 ? "❌" : "⚠️";

  const lines = [
    `${statusIcon} ${resp.status} ${resp.statusText} (${resp.duration}ms)`,
    "",
    "Headers:",
  ];

  const importantHeaders = ["content-type", "content-length", "authorization", "location", "x-request-id", "x-ratelimit-remaining"];
  for (const [k, v] of Object.entries(resp.headers)) {
    if (importantHeaders.some(h => k.toLowerCase().includes(h))) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  lines.push("", "Body:");
  let body = resp.body;

  // Try to pretty-print JSON
  if (resp.headers["content-type"]?.includes("application/json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(body);
      body = pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch {}
  }

  // Truncate
  if (body.length > 8000) {
    body = body.slice(0, 8000) + `\n... [truncated ${body.length - 8000} bytes]`;
  }
  lines.push(body || "(empty body)");
  return lines.join("\n");
}

function buildCurlCommand(method: string, url: string, headers: Record<string, string>, body?: string): string {
  const parts = ["curl", "-s", "-i", `-X ${method}`, `"${url}"`];
  for (const [k, v] of Object.entries(headers)) parts.push(`-H "${k}: ${v}"`);
  if (body) parts.push(`-d '${body.replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}

// ── Tool: http_request ────────────────────────────────────────────────────────

export const httpRequestDef: ToolDefinition = {
  name: "http_request",
  description: "Make an HTTP request for API testing or backend debugging. Supports GET/POST/PUT/PATCH/DELETE. Returns formatted response with status, headers, and body.",
  parameters: {
    type: "object",
    properties: {
      method: { type: "string", description: "HTTP method: GET, POST, PUT, PATCH, DELETE (default: GET)" },
      url: { type: "string", description: "Full URL including protocol" },
      headers: { type: "object", description: "HTTP headers as key-value pairs", additionalProperties: { type: "string" } },
      body: { type: "string", description: "Request body (raw string)" },
      json: { type: "object", description: "Request body as JSON (sets Content-Type automatically)", additionalProperties: true },
      bearer_token: { type: "string", description: "Bearer token for Authorization header" },
      pretty: { type: "boolean", description: "Pretty-print JSON response (default: true)" },
      timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
    },
    required: ["url"],
  },
};

export const httpRequest: ToolHandler = async (args) => {
  const method = ((args["method"] as string) || "GET").toUpperCase();
  const url = args["url"] as string;
  const pretty = args["pretty"] !== false;
  const timeout = ((args["timeout"] as number) || 30) * 1000;

  const headers: Record<string, string> = (args["headers"] as Record<string, string>) || {};

  if (args["bearer_token"]) {
    headers["Authorization"] = `Bearer ${args["bearer_token"]}`;
  }

  let body: string | undefined;
  if (args["json"]) {
    body = JSON.stringify(args["json"]);
    headers["Content-Type"] = "application/json";
  } else if (args["body"]) {
    body = args["body"] as string;
  }

  try {
    const resp = await doRequest(method, url, headers, body, timeout);
    return formatResponse(resp, pretty);
  } catch (e: any) {
    return `❌ Request failed: ${e.message}\n\nDebug command:\n${buildCurlCommand(method, url, headers, body)}`;
  }
};

// ── Tool: http_get / http_post shortcuts ──────────────────────────────────────

export const httpGetDef: ToolDefinition = {
  name: "http_get",
  description: "Quick HTTP GET request. For simple API checks without needing to specify method.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      headers: { type: "object", additionalProperties: { type: "string" } },
      bearer_token: { type: "string" },
    },
    required: ["url"],
  },
};

export const httpGet: ToolHandler = async (args) => {
  return httpRequest({ ...args, method: "GET" });
};

export const httpPostDef: ToolDefinition = {
  name: "http_post",
  description: "Quick HTTP POST request with JSON body. For API testing.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      json: { type: "object", description: "JSON body to send", additionalProperties: true },
      body: { type: "string", description: "Raw body (if not using json)" },
      headers: { type: "object", additionalProperties: { type: "string" } },
      bearer_token: { type: "string" },
    },
    required: ["url"],
  },
};

export const httpPost: ToolHandler = async (args) => {
  return httpRequest({ ...args, method: "POST" });
};
