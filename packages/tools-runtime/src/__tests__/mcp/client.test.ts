import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MCPClient } from "../../mcp/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "fake-mcp-server.mjs");

function makeClient(env: Record<string, string> = {}): MCPClient {
  return new MCPClient({ name: "fake", type: "stdio", command: process.execPath, args: [FIXTURE], env });
}

async function waitUntil(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("MCPClient (stdio, fixture-backed)", () => {
  let client: MCPClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
  });

  it("connects, lists namespaced tools, and round-trips a tool call", async () => {
    client = makeClient();
    await client.connect();

    expect(client.currentStatus).toEqual({ status: "connected" });
    expect(client.currentTools.map((t) => t.name)).toEqual(["echo"]);
    expect(client.toolName("echo")).toBe("fake_echo");

    const result = await client.callTool("echo", { foo: "bar" });
    expect(result.content[0]?.text).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("recovers from a malformed line on the wire and still resolves the next valid response", async () => {
    client = makeClient({ FAKE_MCP_MALFORMED: "1" });
    await client.connect();

    const result = await client.callTool("echo", { ping: "pong" });
    expect(result.content[0]?.text).toBe(JSON.stringify({ ping: "pong" }));
  });

  it("reconnects after the underlying server process exits unexpectedly", async () => {
    client = makeClient();
    await client.connect();
    expect(client.currentStatus).toEqual({ status: "connected" });

    const statuses: string[] = [];
    client.on("status", (e: { status: { status: string } }) => statuses.push(e.status.status));

    (client as unknown as { process: { kill: () => void } }).process.kill();

    await waitUntil(() => statuses.includes("reconnecting"));
    await waitUntil(() => client!.currentStatus.status === "connected");

    expect(client.currentStatus).toEqual({ status: "connected" });
  });
});
