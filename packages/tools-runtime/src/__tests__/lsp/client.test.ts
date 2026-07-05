import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { LSPClient } from "../../lsp/client.js";
import type { LSPServerInfo } from "../../lsp/servers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "fake-lsp-server.mjs");

const SERVER_INFO: LSPServerInfo = {
  id: "fake",
  extensions: [".ts"],
  command: process.execPath,
  args: [FIXTURE],
  rootMarkers: [],
};

describe("LSPClient (fixture-backed)", () => {
  let root: string;
  let filePath: string;
  let client: LSPClient | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lsp-test-"));
    filePath = join(root, "file.ts");
    writeFileSync(filePath, "const x = 1;\n");
  });

  afterEach(async () => {
    await client?.stop();
    client = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it("completes the initialize handshake", async () => {
    client = new LSPClient(SERVER_INFO, root);
    await client.start();

    expect(client.isRunning).toBe(true);
  });

  it("round-trips hover and definition after opening a file", async () => {
    client = new LSPClient(SERVER_INFO, root);
    await client.start();

    const hover = await client.hover(filePath, 0, 6);
    expect(hover).toBe("fake hover text");

    const defs = await client.definition(filePath, 0, 6);
    expect(defs).toEqual([
      {
        uri: expect.stringContaining("file.ts"),
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      },
    ]);
  });

  it("delivers a pushed diagnostic after opening a file, respecting the debounce", async () => {
    client = new LSPClient(SERVER_INFO, root);
    await client.start();

    const diagnostics = await client.getDiagnostics(filePath);

    expect(diagnostics).toEqual([expect.objectContaining({ message: "fake diagnostic", severity: 1 })]);
  });

  it("shuts down cleanly on stop(), emitting a real process exit", async () => {
    client = new LSPClient(SERVER_INFO, root);
    await client.start();

    const exited = new Promise<void>((resolve) => client!.once("exit", () => resolve()));
    await client.stop();
    await exited;

    expect(client.isRunning).toBe(false);
  });
});
