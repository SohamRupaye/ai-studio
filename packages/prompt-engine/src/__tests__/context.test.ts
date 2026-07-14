import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Store } from "@squirl/database";
import { buildPayload } from "../context.js";

let tmpDir: string;
let store: Store;
let projectId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "context-test-"));
  store = new Store(join(tmpDir, "test.db"));
  const org = store.createOrganisation("Org");
  projectId = store.createProject(org.id, "Project").id;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildPayload — selected artifacts", () => {
  it("attaches selected artifacts as a <selected_artifacts> block and reports their tokens", async () => {
    const branch = store.createBranch("main", "m");
    const artifact = store.createArtifact(branch.id, projectId, "document", "API spec", "The endpoint returns 42.");
    store.setSelectedArtifacts(branch.id, [artifact.id]);
    store.addMessage(branch.id, "user", "hello");

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    expect(payload.systemContext).toContain("<selected_artifacts>");
    expect(payload.systemContext).toContain("## API spec");
    expect(payload.systemContext).toContain("The endpoint returns 42.");
    expect(payload.artifactTokens).toBeGreaterThan(0);
    expect(payload.nativeDocuments).toEqual([]);
  });

  it("routes a selected PDF to nativeDocuments instead of text when the model reads PDFs", async () => {
    const branch = store.createBranch("main", "m");
    store.createUploadedArtifact({
      id: "pdf-1", branchId: branch.id, projectId, type: "document",
      title: "report.pdf", content: "extracted text layer", originalFilename: "report.pdf",
      mime: "application/pdf", blobPath: "blobs/pdf-1.pdf", byteSize: 120_000, sha256: "x",
    });
    store.setSelectedArtifacts(branch.id, ["pdf-1"]);
    store.addMessage(branch.id, "user", "hello");

    const native = await buildPayload(store, store.getBranch(branch.id)!, undefined, undefined, undefined, { nativePdf: true });
    expect(native.nativeDocuments).toEqual([
      { id: "pdf-1", title: "report.pdf", blobPath: "blobs/pdf-1.pdf", mime: "application/pdf" },
    ]);
    expect(native.systemContext).not.toContain("extracted text layer");
    expect(native.artifactTokens).toBeGreaterThan(0);

    // Without native support the same PDF rides as extracted text, as before.
    const textual = await buildPayload(store, store.getBranch(branch.id)!);
    expect(textual.nativeDocuments).toEqual([]);
    expect(textual.systemContext).toContain("extracted text layer");
  });

  it("includes no block and zero tokens when nothing is selected", async () => {
    const branch = store.createBranch("main", "m");
    store.addMessage(branch.id, "user", "hello");

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    expect(payload.systemContext).not.toContain("<selected_artifacts>");
    expect(payload.artifactTokens).toBe(0);
  });

  it("skips selected ids whose artifact was deleted", async () => {
    const branch = store.createBranch("main", "m");
    store.setSelectedArtifacts(branch.id, ["gone"]);
    store.addMessage(branch.id, "user", "hello");

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    expect(payload.systemContext).not.toContain("<selected_artifacts>");
    expect(payload.artifactTokens).toBe(0);
  });

  it("reattaches persisted tool calls to assistant hot messages so the model remembers its own actions", async () => {
    const branch = store.createBranch("main", "m");
    store.addMessage(branch.id, "user", "/debate sqlite vs postgres");
    store.addMessage(branch.id, "assistant", "Debate summary.", "m", [
      { name: "bash", success: true, argsPreview: '{"command":"claude -p …"}', resultPreview: "SQLite wins" },
      { name: "web_search", success: false },
    ]);
    store.addMessage(branch.id, "user", "what commands did you run?");

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    const assistant = payload.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("Debate summary.");
    expect(assistant.content).toContain("Tool calls you made during this turn");
    expect(assistant.content).toContain('bash({"command":"claude -p …"}) ✓ → SQLite wins');
    expect(assistant.content).toContain("web_search ✗ failed");
    // User messages and the stored row itself stay untouched.
    expect(payload.messages[0]!.content).toBe("/debate sqlite vs postgres");
    expect(store.getMessages(branch.id)[1]!.content).toBe("Debate summary.");
  });

  it("caps the tool trail and notes the overflow", async () => {
    const branch = store.createBranch("main", "m");
    store.addMessage(branch.id, "user", "go");
    store.addMessage(
      branch.id,
      "assistant",
      "Done.",
      "m",
      Array.from({ length: 15 }, (_, i) => ({ name: `tool${i}`, success: true })),
    );

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    const assistant = payload.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("tool11");
    expect(assistant.content).not.toContain("tool12");
    expect(assistant.content).toContain("…and 3 more calls");
  });

  it("truncates an oversized artifact with a visible marker instead of blowing the budget", async () => {
    const branch = store.createBranch("main", "m");
    // Far beyond the 8k-token per-artifact cap.
    const huge = "lorem ipsum dolor sit amet ".repeat(4000);
    const artifact = store.createArtifact(branch.id, projectId, "document", "Huge doc", huge);
    store.setSelectedArtifacts(branch.id, [artifact.id]);
    store.addMessage(branch.id, "user", "hello");

    const payload = await buildPayload(store, store.getBranch(branch.id)!);

    expect(payload.systemContext).toContain("[truncated");
    expect(payload.systemContext.length).toBeLessThan(huge.length);
  });
});
