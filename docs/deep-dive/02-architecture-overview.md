# 02 — Architecture Overview

> The 10,000-foot view: how the whole thing is put together and how a request flows through it. Read this before the deep-dive files (03–08).

## Shape of the codebase

It's a **Yarn 4 + Turborepo monorepo** — ~40k lines of TypeScript across **12 packages + 1 app**. Everything is TypeScript end to end (main process, renderer, and all packages).

```
apps/
  desktop         → Electron app: main process (Node) + renderer (React 19)   [~12k lines]
packages/
  shared          → Core domain types (Message, Branch, Org, Project, Chat…)   [pure types]
  tokenizer       → Token counting + model context limits + capability checks
  event-bus       → The typed IPC contract — single source of truth for ~90 channels
  database        → SQLite Store (the whole org→project→space→chat→branch hierarchy)
  graph-engine    → SQLite knowledge graph + local MiniLM embeddings
  providers       → Anthropic / OpenAI / Google / Codex + the retry Router      [~3.3k lines]
  context-engine  → RAG retrieval with MMR reranking, cross-branch sharing
  prompt-engine   → Tiered context builder + progressive summarization + branch-diff
  ai-core         → Agent loop, classifier, cost tracker, subagents             [~3k lines]
  tools-runtime   → 50+ tools, MCP client + OAuth, LSP client, Skills           [~9.7k lines]
  ui              → Shared React hooks
tooling/
  eslint / typescript / vitest   → shared configs
```

## The layering (this is the mental model to convey)

Think of it as concentric layers, from "talks to the outside world" inward to "orchestrates everything":

1. **Foundation** — `shared` (types), `tokenizer`, `event-bus` (the contract). No business logic.
2. **Persistence & knowledge** — `database` (SQLite store) and `graph-engine` (knowledge graph). Where context lives.
3. **The model boundary** — `providers` (the multi-LLM Router). The only layer that knows about vendors.
4. **Context intelligence** — `context-engine` (retrieval) and `prompt-engine` (assembly). **The differentiator.**
5. **Execution** — `ai-core` (the agent loop) and `tools-runtime` (the tools). Where the AI acts.
6. **The app** — `apps/desktop` wires it all together behind an Electron UI.

A useful thing to say: **the biggest, most-tested packages are the ones that manage *context* (`tools-runtime`, `prompt-engine`, `context-engine`, `graph-engine`), not the ones that talk to models.** That's the product thesis reflected in the code's center of gravity.

## Dependency discipline

Two rules keep the graph clean and are worth mentioning:

- **`tools-runtime` never imports `ai-core`** (that would be circular — the tools need to run agents, and the agent core registers the tools). Instead `ai-core` **injects** its task runner into `tools-runtime` at startup (`setSubagentDependencies`). Dependency inversion.
- **`event-bus` is the single source of truth** for the main↔renderer boundary — every IPC channel is a typed entry there, so the frontend and backend can't drift out of sync.

## The tech stack (one line each)

| Layer | Choice | Why (short) |
|---|---|---|
| Runtime | Electron 33, Node 20+ | Local-first: native processes, file access, on-device ML |
| Language | TypeScript 5.7 | One language across main/renderer/packages; typed IPC |
| Build | Yarn 4 workspaces + Turborepo + Vite 6 | Fast incremental monorepo builds |
| Frontend | React 19 + Tailwind v4 + Base UI | Modern, owned design system (not Radix) |
| Database | SQLite (`better-sqlite3`) | Ships in the app, synchronous, zero-config |
| Embeddings | HuggingFace Transformers.js (MiniLM) | Local, no network, no per-turn cost |
| LLMs | Anthropic, OpenAI, Google, Codex OAuth | Model-agnostic, BYOK |
| Packaging | Electron Forge | Standard Electron distributables |

## End-to-end request flow (the "walk me through a message" answer)

When a user sends a message on a branch:

1. **Renderer → main** via a typed `chat:send` IPC (`window.ipc.invoke`).
2. **Main resolves the settings cascade** — branch → project → org → the right **per-org router** (with that org's API keys). Builds a fresh runtime for this turn (so subagents inherit the right model/keys).
3. **Context assembly** (`prompt-engine.buildPayload`): global/project/chat/branch **memory**, **ancestry** (inherited fork context), **conversation summaries**, **RAG-retrieved** knowledge-graph hits (MMR-reranked, cross-branch), **pinned rules**, **selected artifacts** — all assembled into a tiered system prompt that **degrades gracefully** if it exceeds the model's context window.
4. **The agent loop** (`ai-core.Agent`) streams from the provider. If the model calls tools, `tools-runtime` executes them (bash, file ops, MCP calls, subagent delegation…) and the results feed back. Loops until done or capped.
5. **Streaming out** — every token, tool event, and subagent event is pushed to the renderer over `chat:stream`, each tagged with a `branchId` so streams don't cross branches.
6. **Persistence** — the reply, tool-call previews, cost, and per-tier context stats are saved. Artifacts are extracted. In the background, the **classifier** distills the turn into new knowledge-graph nodes so context compounds.

That single flow touches almost every package — it's the best thing to be able to narrate end to end. (Full detail in `07`, `05`, `06`, and the desktop doc.)

## Testing posture

- **Vitest** across packages. The highest-risk files (agent loop, classifier, MCP/LSP clients, the Store, prompt assembly) have real tests.
- **Fixture-based integration tests over mocks** for the wire protocols — MCP OAuth and Streamable HTTP are tested against *real local fake servers* that actually implement the RFCs and recompute PKCE challenges. That's why the protocol code can be trusted.
- Honest gaps are tracked (the subagent orchestrator, the registry wiring, and the desktop main-process handlers have no test harness yet) — listed explicitly, not hidden.

## Build/run gotchas (real monorepo friction, good to know)

- **`better-sqlite3` is a native module** rebuilt for Electron's ABI on install; running plain-Node vitest needs it rebuilt for Node again. Recurring friction, not a regression.
- **Vite's dep-optimizer cache** doesn't invalidate when a workspace package's dist rebuilds without a version bump — so a new runtime export in a package can throw "no export named…" in the renderer until the cache is cleared. `@squirl/shared` is excluded from optimizeDeps for this reason.
- **Main-process changes need a `yarn dev` restart** (renderer changes hot-reload). Knowing which changes need a restart is part of the daily workflow.
