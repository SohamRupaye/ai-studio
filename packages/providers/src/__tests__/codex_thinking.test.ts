import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StreamEvent } from "../base.js";

// In-memory fs so the provider reads a fake ~/.ai-studio/auth.json.
const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  },
  writeFileSync: (path: string, data: string) => { files.set(path, data); },
  mkdirSync: () => {},
  unlinkSync: (path: string) => { files.delete(path); },
}));

const AUTH_FILE = join(homedir(), ".ai-studio", "auth.json");

function sseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, text: async () => "" } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  files.clear();
  files.set(AUTH_FILE, JSON.stringify({ access: "tok", refresh: "r", expires: Date.now() + 3_600_000 }));
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Codex thinking", () => {
  it("requests reasoning summaries and yields reasoning deltas as thinking", async () => {
    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    fetchMock.mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "Weighing options." })}`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Answer." })}`,
        "data: [DONE]",
      ]),
    );
    const provider = new CodexOAuthProvider();
    const events: StreamEvent[] = [];
    for await (const ev of provider.stream("gpt-5", [{ role: "user", content: "q" }], "sys")) events.push(ev);

    expect(events).toContainEqual({ type: "thinking", text: "Weighing options." });
    expect(events).toContainEqual({ type: "text", text: "Answer." });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.reasoning).toEqual({ summary: "auto" });
  });

  it("retries without the reasoning param on a 400", async () => {
    const { CodexOAuthProvider } = await import("../codex_oauth.js");
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "bad reasoning" } as unknown as Response)
      .mockResolvedValueOnce(
        sseResponse([
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hi." })}`,
          "data: [DONE]",
        ]),
      );
    const provider = new CodexOAuthProvider();
    const events: StreamEvent[] = [];
    for await (const ev of provider.stream("gpt-5", [{ role: "user", content: "q" }], "sys")) events.push(ev);

    expect(events).toContainEqual({ type: "text", text: "Hi." });
    const retryBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(retryBody.reasoning).toBeUndefined();
  });
});
