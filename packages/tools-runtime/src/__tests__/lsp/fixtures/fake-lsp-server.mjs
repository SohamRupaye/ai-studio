// Minimal Content-Length-framed JSON-RPC server for LSPClient tests. No external deps.
// Handles just enough of the LSP handshake to be useful: initialize, textDocument/hover,
// textDocument/definition, shutdown/exit, and pushes one publishDiagnostics notification
// shortly after didOpen.
import { Buffer } from "node:buffer";

let buffer = "";
let contentLength = -1;

function send(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function handleMessage(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      send({ jsonrpc: "2.0", id, result: { capabilities: {} } });
      break;
    case "initialized":
      break; // notification, no response
    case "textDocument/didOpen": {
      const uri = params.textDocument.uri;
      setTimeout(() => {
        send({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri,
            diagnostics: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                severity: 1,
                message: "fake diagnostic",
              },
            ],
          },
        });
      }, 20);
      break;
    }
    case "textDocument/hover":
      send({ jsonrpc: "2.0", id, result: { contents: { kind: "markdown", value: "fake hover text" } } });
      break;
    case "textDocument/definition":
      send({
        jsonrpc: "2.0",
        id,
        result: [
          {
            uri: params.textDocument.uri,
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
          },
        ],
      });
      break;
    case "shutdown":
      send({ jsonrpc: "2.0", id, result: null });
      break;
    case "exit":
      process.exit(0);
      break;
    default:
      if (id != null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (true) {
    if (contentLength === -1) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      contentLength = parseInt(match[1], 10);
      buffer = buffer.slice(headerEnd + 4);
    }
    if (Buffer.byteLength(buffer) < contentLength) break;
    const body = buffer.slice(0, contentLength);
    buffer = buffer.slice(contentLength);
    contentLength = -1;
    try {
      handleMessage(JSON.parse(body));
    } catch {}
  }
});
