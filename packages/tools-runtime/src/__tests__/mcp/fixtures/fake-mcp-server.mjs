// Minimal JSON-RPC 2.0 stdio server for MCPClient tests. No external deps.
// Handles just enough of the MCP handshake to be useful: initialize, tools/list,
// tools/call (echoes its arguments back), resources/list.
//
// Set FAKE_MCP_MALFORMED=1 to have the server emit one garbage line right before
// its first tools/call response, to exercise the client's line-parse recovery.
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, terminal: false });
let malformedSent = false;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  if (method === "tools/call" && process.env.FAKE_MCP_MALFORMED === "1" && !malformedSent) {
    malformedSent = true;
    process.stdout.write("not-json-garbage\n");
  }

  switch (method) {
    case "initialize":
      send({ jsonrpc: "2.0", id, result: { capabilities: {} } });
      break;
    case "notifications/initialized":
      break; // notification, no response expected
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: { tools: [{ name: "echo", description: "Echoes args back", inputSchema: { type: "object" } }] },
      });
      break;
    case "tools/call":
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(params?.arguments ?? {}) }] },
      });
      break;
    case "resources/list":
      send({ jsonrpc: "2.0", id, result: { resources: [] } });
      break;
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
