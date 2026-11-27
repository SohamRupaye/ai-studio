import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, GlobalMemory } from "@squirl/database";
import { buildPayload } from "@squirl/prompt-engine";
import type { Router } from "@squirl/providers";
import { createDefaultRegistry } from "@squirl/tools-runtime";
import { Agent, type AgentStreamEvent } from "../agent.js";

/**
 * End-to-end cross-package integration test:
 * Store (SQLite) + GlobalMemory (branch-scoped) + Prompt Engine (buildPayload)
 * + Tools Runtime (real disk tools) + AI Core (Agent loop).
 */
describe("cross-package workflow integration", () => {
  let tmpDir: string;
  let store: Store;
  let memory: GlobalMemory;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "squirl-e2e-"));
    store = new Store(join(tmpDir, "squirl.db"));
    memory = new GlobalMemory(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs an agent tool turn, persists artifacts/messages in SQLite, and isolates branched context", async () => {
    const org = store.createOrganisation("Acme");
    const project = store.createProject(org.id, "Platform");
    const chat = store.createChat(project.id, "Auth Design", undefined, "test-model");
    const trunk = store.listBranches(chat.id)[0]!;

    // 1. Seed a shared global memory fact and an artifact on the trunk branch
    const mem1 = memory.add("Use PostgreSQL for primary storage", `project:${project.id}`);
    const spec = store.createArtifact(trunk.id, project.id, "document", "Auth Spec", "Use OAuth 2.1 PKCE.");
    store.setSelectedArtifacts(trunk.id, [spec.id]);
    store.addMessage(trunk.id, "user", "Create a config file for auth.");

    // 2. Build the prompt payload from SQLite + artifacts + living memory
    const payload = await buildPayload(store, store.getBranch(trunk.id)!, undefined, memory);
    expect(payload.systemContext).toContain("Use OAuth 2.1 PKCE.");
    expect(payload.systemContext).toContain("Use PostgreSQL for primary storage");

    // 3. Execute a real Agent loop with the full default tools-runtime registry
    const registry = createDefaultRegistry();

    const outPath = join(tmpDir, "auth.json");
    let call = 0;
    const router = {
      call: vi.fn(),
      stream: vi.fn(() => {
        call++;
        if (call === 1) {
          return (async function* () {
            yield {
              type: "tool_call" as const,
              id: "tc-1",
              name: "write_file",
              arguments: { path: outPath, content: '{"pkce":true}\n' },
            };
          })();
        }
        if (call === 2) {
          return (async function* () {
            yield {
              type: "tool_call" as const,
              id: "tc-2",
              name: "read_file",
              arguments: { path: outPath },
            };
          })();
        }
        return (async function* () {
          yield { type: "text" as const, text: "Created auth.json with PKCE enabled." };
        })();
      }),
    } as unknown as Router;

    const agent = new Agent(router, registry);
    const events: AgentStreamEvent[] = [];
    for await (const ev of agent.run("test-model", payload.messages, payload.systemContext)) {
      events.push(ev);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.result.iterations).toBe(3);
      expect(done.result.toolCalls).toHaveLength(2);
      expect(done.result.text).toContain("PKCE enabled");
      store.addMessage(trunk.id, "assistant", done.result.text);
    }
    expect(readFileSync(outPath, "utf-8")).toBe('{"pkce":true}\n');

    // 4. Fork two sibling branches from trunk and verify branch-scoped memory supersession
    const branchA = store.createBranch("sqlite-experiment", "test-model", trunk.id, undefined, chat.id);
    const branchB = store.createBranch("postgres-prod", "test-model", trunk.id, undefined, chat.id);

    const mem2 = memory.addWithStatus("Use SQLite for embedded mode", `project:${project.id}`, branchA.id).fact;
    memory.supersede(mem1.id, mem2.id, branchA.id);

    const payloadA = await buildPayload(store, store.getBranch(branchA.id)!, undefined, memory);
    const payloadB = await buildPayload(store, store.getBranch(branchB.id)!, undefined, memory);

    // Branch A superseded PostgreSQL -> sees SQLite, not PostgreSQL
    expect(payloadA.systemContext).toContain("Use SQLite for embedded mode");
    expect(payloadA.systemContext).not.toContain("Use PostgreSQL for primary storage");

    // Sibling Branch B did NOT supersede PostgreSQL -> still sees it!
    expect(payloadB.systemContext).toContain("Use PostgreSQL for primary storage");
    // Both forks inherited trunk's selected artifact
    expect(payloadA.systemContext).toContain("Use OAuth 2.1 PKCE.");
    expect(payloadB.systemContext).toContain("Use OAuth 2.1 PKCE.");
  });
});
