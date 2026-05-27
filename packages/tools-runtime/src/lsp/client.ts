/**
 * LSP Client - Full protocol client with didChange sync, pull+push diagnostics,
 * document versioning, lazy spawning, graceful shutdown
 */
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { pathToFileURL, fileURLToPath } from "url";
import { getLanguageId } from "./language";
import { type LSPServerInfo, findServersForExtension, findRoot } from "./servers";

export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

interface LSPMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

type PendingReq = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const INIT_TIMEOUT = 45_000;
const REQUEST_TIMEOUT = 10_000;
const DIAG_DEBOUNCE = 150;
const DIAG_WAIT_TIMEOUT = 5_000;

export class LSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private reqId = 0;
  private pending = new Map<number, PendingReq>();
  private buffer = "";
  private contentLength = -1;
  private initialized = false;
  private serverCapabilities: Record<string, unknown> = {};
  private openDocs = new Map<string, { version: number; languageId: string; text: string }>();
  private pushDiagnostics = new Map<string, Diagnostic[]>();
  private pullDiagnostics = new Map<string, Diagnostic[]>();
  private syncKind: number = 1; // 1=full, 2=incremental
  private diagTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly serverInfo: LSPServerInfo,
    readonly root: string,
  ) {
    super();
  }

  get isRunning(): boolean {
    return this.process !== null && this.initialized;
  }

  /** Start the LSP server process and initialize */
  async start(): Promise<void> {
    const cmd = this.serverInfo.command;
    const args = this.serverInfo.args ?? [];
    this.process = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.root,
      env: { ...process.env, ...this.serverInfo.env },
    });
    this.process.stdout!.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.process.stderr!.on("data", () => {});
    this.process.on("exit", () => { this.initialized = false; this.emit("exit"); });
    this.process.on("error", (err) => this.emit("error", err));
    await this.initialize();
  }

  /** Graceful shutdown */
  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      await this.request("shutdown", null, 5000);
      this.notify("exit");
    } catch {}
    setTimeout(() => this.process?.kill("SIGKILL"), 3000);
    this.process.kill("SIGTERM");
    this.process = null;
    this.initialized = false;
    this.openDocs.clear();
    this.pushDiagnostics.clear();
    this.pullDiagnostics.clear();
  }

  /** Open or sync a document */
  async openFile(filePath: string, content?: string): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    const languageId = getLanguageId(filePath) ?? "plaintext";
    const text = content ?? await fs.readFile(filePath, "utf-8");

    const existing = this.openDocs.get(uri);
    if (existing) {
      // didChange with incremented version
      existing.version++;
      existing.text = text;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: existing.version },
        contentChanges: this.syncKind === 2
          ? [{ text }] // full replacement for simplicity; incremental would need diff
          : [{ text }],
      });
    } else {
      this.openDocs.set(uri, { version: 1, languageId, text });
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    }

    // Notify file watcher
    this.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri, type: existing ? 2 : 1 }], // 1=created, 2=changed
    });
  }

  /** Close a document */
  async closeFile(filePath: string): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    if (!this.openDocs.has(uri)) return;
    this.openDocs.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** Get merged diagnostics (push + pull) for a file */
  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);

    // Wait for push diagnostics with debounce
    const pushResult = await this.waitForPushDiagnostics(uri);

    // Also try pull diagnostics if server supports it
    let pullResult: Diagnostic[] = [];
    if (this.serverCapabilities.diagnosticProvider) {
      pullResult = await this.pullDiagnosticsForFile(uri);
    }

    // Merge and deduplicate
    const all = [...(pushResult ?? []), ...pullResult];
    return this.deduplicateDiagnostics(all);
  }

  /** Get all diagnostics across all open files */
  getAllDiagnostics(): Map<string, Diagnostic[]> {
    const result = new Map<string, Diagnostic[]>();
    for (const [uri] of this.openDocs) {
      const push = this.pushDiagnostics.get(uri) ?? [];
      const pull = this.pullDiagnostics.get(uri) ?? [];
      const merged = this.deduplicateDiagnostics([...push, ...pull]);
      if (merged.length > 0) {
        const filePath = fileURLToPath(uri);
        result.set(filePath, merged);
      }
    }
    return result;
  }

  // --- LSP Operations ---

  async hover(filePath: string, line: number, character: number): Promise<string | null> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    }).catch(() => null) as { contents?: unknown } | null;
    if (!result?.contents) return null;
    if (typeof result.contents === "string") return result.contents;
    if (typeof result.contents === "object" && "value" in (result.contents as any)) {
      return (result.contents as any).value;
    }
    return JSON.stringify(result.contents);
  }

  async definition(filePath: string, line: number, character: number): Promise<Array<{ uri: string; range: any }>> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    }).catch(() => null);
    if (!result) return [];
    const items = Array.isArray(result) ? result : [result];
    return items.map((item: any) => ({
      uri: item.uri ?? item.targetUri,
      range: item.range ?? item.targetRange,
    }));
  }

  async references(filePath: string, line: number, character: number): Promise<Array<{ uri: string; range: any }>> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    }).catch(() => null);
    return Array.isArray(result) ? result : [];
  }

  async documentSymbols(filePath: string): Promise<any[]> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri },
    }).catch(() => null);
    return Array.isArray(result) ? result : [];
  }

  async workspaceSymbols(query: string): Promise<any[]> {
    const result = await this.request("workspace/symbol", { query }).catch(() => null);
    return Array.isArray(result) ? result : [];
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<any> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    return this.request("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    }).catch(() => null);
  }

  async codeActions(filePath: string, range: any, diagnostics: Diagnostic[] = []): Promise<any[]> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/codeAction", {
      textDocument: { uri },
      range,
      context: { diagnostics },
    }).catch(() => null);
    return Array.isArray(result) ? result : [];
  }

  async implementation(filePath: string, line: number, character: number): Promise<any[]> {
    const uri = pathToFileURL(filePath).href;
    await this.openFile(filePath);
    const result = await this.request("textDocument/implementation", {
      textDocument: { uri },
      position: { line, character },
    }).catch(() => null);
    return Array.isArray(result) ? result : [];
  }

  // --- Private ---

  private async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.root).href;
    const result = (await this.request("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.root,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: true, didSave: true },
          publishDiagnostics: { relatedInformation: true },
          diagnostic: { dynamicRegistration: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true },
          rename: { prepareSupport: true },
          codeAction: { dynamicRegistration: true },
          implementation: { dynamicRegistration: true },
        },
        workspace: {
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
          workspaceFolders: true,
          symbol: { dynamicRegistration: true },
        },
      },
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
    }, INIT_TIMEOUT)) as any;

    this.serverCapabilities = result?.capabilities ?? {};
    this.syncKind = this.getSyncKind();
    this.initialized = true;
    this.notify("initialized", {});

    // Send configuration if server needs it
    if (this.serverInfo.initialization) {
      this.notify("workspace/didChangeConfiguration", {
        settings: this.serverInfo.initialization,
      });
    }
  }

  private getSyncKind(): number {
    const sync = this.serverCapabilities.textDocumentSync;
    if (typeof sync === "number") return sync;
    if (typeof sync === "object" && sync && "change" in sync) return (sync as any).change ?? 1;
    return 1;
  }

  private async waitForPushDiagnostics(uri: string): Promise<Diagnostic[]> {
    // If we already have cached diagnostics, use debounce
    if (this.pushDiagnostics.has(uri)) {
      await new Promise((r) => setTimeout(r, DIAG_DEBOUNCE));
      return this.pushDiagnostics.get(uri) ?? [];
    }
    // Wait for first push
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(this.pushDiagnostics.get(uri) ?? []);
      }, DIAG_WAIT_TIMEOUT);
      const handler = (data: { uri: string }) => {
        if (data.uri === uri) {
          clearTimeout(timeout);
          this.removeListener("diagnostics", handler);
          setTimeout(() => resolve(this.pushDiagnostics.get(uri) ?? []), DIAG_DEBOUNCE);
        }
      };
      this.on("diagnostics", handler);
    });
  }

  private async pullDiagnosticsForFile(uri: string): Promise<Diagnostic[]> {
    const result = (await this.request("textDocument/diagnostic", {
      textDocument: { uri },
    }, 3000).catch(() => null)) as any;
    const items = result?.items ?? [];
    this.pullDiagnostics.set(uri, items);
    return items;
  }

  private deduplicateDiagnostics(items: Diagnostic[]): Diagnostic[] {
    const seen = new Set<string>();
    return items.filter((d) => {
      const key = `${d.severity}:${d.range.start.line}:${d.range.start.character}:${d.message}:${d.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // --- JSON-RPC Protocol ---

  private request(method: string, params: unknown, timeout = REQUEST_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process) return reject(new Error("LSP not running"));
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.process) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: LSPMessage): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process!.stdin!.write(header + body);
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }
      if (this.buffer.length < this.contentLength) break;
      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;
      try {
        this.handleMessage(JSON.parse(body));
      } catch {}
    }
  }

  private handleMessage(msg: LSPMessage): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const req = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(req.timer);
      if (msg.error) req.reject(new Error(msg.error.message));
      else req.resolve(msg.result);
    } else if (msg.method) {
      this.handleNotification(msg);
    }
  }

  private handleNotification(msg: LSPMessage): void {
    switch (msg.method) {
      case "textDocument/publishDiagnostics": {
        const params = msg.params as { uri: string; diagnostics: Diagnostic[] };
        this.pushDiagnostics.set(params.uri, params.diagnostics);
        this.emit("diagnostics", { uri: params.uri, diagnostics: params.diagnostics });
        break;
      }
      case "workspace/configuration": {
        // Respond with settings
        if (msg.id != null) {
          const params = msg.params as { items: Array<{ section?: string }> };
          const results = (params.items ?? []).map((item) => {
            if (!item.section) return this.serverInfo.initialization ?? {};
            const parts = item.section.split(".");
            let val: any = this.serverInfo.initialization ?? {};
            for (const p of parts) val = val?.[p];
            return val ?? null;
          });
          this.send({ jsonrpc: "2.0", id: msg.id, result: results });
        }
        break;
      }
      case "client/registerCapability":
      case "window/logMessage":
      case "window/showMessage":
        // Acknowledge if needed
        if (msg.id != null) this.send({ jsonrpc: "2.0", id: msg.id, result: null });
        break;
    }
  }
}

/**
 * LSPManager - Lazy spawning, caching, and coordination of multiple LSP clients
 */
export class LSPManager extends EventEmitter {
  private clients = new Map<string, LSPClient>(); // key: serverId:root
  private broken = new Set<string>();
  private spawning = new Map<string, Promise<LSPClient | null>>();
  private customServers: LSPServerInfo[] = [];

  /** Register custom server definitions */
  registerServers(servers: LSPServerInfo[]): void {
    this.customServers.push(...servers);
  }

  /** Get or lazily spawn an LSP client for a file */
  async getClientForFile(filePath: string): Promise<LSPClient | null> {
    const ext = path.extname(filePath).toLowerCase();
    const servers = [
      ...this.customServers.filter((s) => s.extensions.includes(ext)),
      ...findServersForExtension(ext),
    ];
    if (servers.length === 0) return null;

    // Find root for the best matching server
    const server = servers[0];
    const root = await findRoot(filePath, server.rootMarkers);
    const key = `${server.id}:${root}`;

    if (this.broken.has(key)) return null;
    if (this.clients.has(key)) return this.clients.get(key)!;

    // Deduplicate inflight spawns
    if (this.spawning.has(key)) return this.spawning.get(key)!;

    const promise = this.spawnClient(server, root, key);
    this.spawning.set(key, promise);
    const client = await promise;
    this.spawning.delete(key);
    return client;
  }

  /** Open/sync a file in all matching LSP servers */
  async touchFile(filePath: string, content?: string): Promise<void> {
    const client = await this.getClientForFile(filePath);
    if (client) await client.openFile(filePath, content);
  }

  /** Get aggregated diagnostics from all clients */
  getAllDiagnostics(): Map<string, Diagnostic[]> {
    const result = new Map<string, Diagnostic[]>();
    for (const client of this.clients.values()) {
      for (const [file, diags] of client.getAllDiagnostics()) {
        const existing = result.get(file) ?? [];
        result.set(file, [...existing, ...diags]);
      }
    }
    return result;
  }

  /** Shut down all LSP servers gracefully */
  async shutdown(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.values()).map((c) => c.stop()),
    );
    this.clients.clear();
    this.broken.clear();
  }

  private async spawnClient(server: LSPServerInfo, root: string, key: string): Promise<LSPClient | null> {
    const client = new LSPClient(server, root);
    try {
      await client.start();
      this.clients.set(key, client);
      client.on("exit", () => { this.clients.delete(key); });
      this.emit("client_started", { serverId: server.id, root });
      return client;
    } catch (err) {
      // If binary not found and install available, try auto-install
      if (server.install && err instanceof Error && err.message.includes("ENOENT")) {
        const installed = await server.install();
        if (installed) {
          try {
            await client.start();
            this.clients.set(key, client);
            client.on("exit", () => { this.clients.delete(key); });
            return client;
          } catch {}
        }
      }
      this.broken.add(key);
      return null;
    }
  }
}

/** Formatting utilities for diagnostics */
export function formatDiagnostic(d: Diagnostic): string {
  const severity = ["", "ERROR", "WARN", "INFO", "HINT"][d.severity ?? 1];
  return `${severity} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}`;
}

export function formatDiagnosticsReport(file: string, diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 1);
  if (errors.length === 0) return "";
  const limited = errors.slice(0, 20);
  const more = errors.length > 20 ? `\n... and ${errors.length - 20} more` : "";
  return `<diagnostics file="${file}">\n${limited.map(formatDiagnostic).join("\n")}${more}\n</diagnostics>`;
}

// Legacy compat export
const _singletonManager = new LSPManager();
/** @deprecated Use LSPManager.getClientForFile directly */
export async function getClient(filePath: string) { return _singletonManager.getClientForFile(filePath); }
