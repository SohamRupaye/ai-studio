# 14 — Quick Facts & Glossary (Cram Sheet)

> A quick-reference cram sheet: numbers, names, and one-liners worth having on hand.

## The 30-second pitch (memorize)

> AI Studio is "Git for AI-native work" — a model-agnostic desktop app where **context, not chat, is the primary object.** It accumulates your project's knowledge, decisions, and artifacts in a local knowledge graph and lets you **branch and fork conversations** like code, so you never re-explain context to an AI again.

## Numbers to know

| Fact | Value |
|---|---|
| Started | 2026-05-27 (solo-built, ~2 months of work) |
| Size | ~40k lines TypeScript, 12 packages + 1 app, 335 source files |
| Biggest package | `tools-runtime` (~9.7k lines) |
| Desktop app | ~12k lines |
| Built-in tools | ~50 |
| LSP language servers cataloged | 37 |
| IPC channels | ~90 invoke + a handful of push |
| Embedding model | MiniLM-L6-v2, 384 dims, local via Transformers.js |
| Embedding merge threshold | 0.88 (same-concept merge) |
| RAG retrieval | top-3, over-fetch 5×, MMR λ=0.7 |
| Agent iteration caps | 10 (top-level), 15 (subagent) |
| Subagent fan-out | up to 4 parallel |
| Subagent timeouts | 5 min (blocking), 10 min (background) |
| Router retries | 3, exponential backoff (1s/2s/4s) |
| Model cache TTL | 1 hour |
| Pilot validation | one 18-person startup |
| RAM baseline | ~400 MB (near Electron's floor) |

## The domain hierarchy (say it fast)

**Organisation → Project → Space → Chat → Branch → Message**

- Space = functional area (Design / Development / Business) = the pilot's handoff boundaries
- You always work **on a Branch**, never "in a chat"
- Every chat has a `main` trunk (invariant)

## The tech stack (one breath)

Electron 33 · TypeScript 5.7 · React 19 · Tailwind v4 · Base UI · SQLite (better-sqlite3) · Yarn 4 + Turborepo + Vite 6 · Transformers.js (local embeddings) · Electron Forge.

## The 12 packages (one line each)

- **shared** — domain types + the subagent event reducer.
- **tokenizer** — token counting, context limits, `supportsVision`/`supportsPdfInput`.
- **event-bus** — the typed IPC contract (single source of truth).
- **database** — SQLite `Store`, raw SQL, the whole hierarchy, soft-delete, migrations.
- **graph-engine** — SQLite knowledge graph + local MiniLM embeddings.
- **providers** — Anthropic/OpenAI/Google/Codex adapters + the retry Router.
- **context-engine** — RAG retrieval + MMR reranking, cross-branch sharing.
- **prompt-engine** — tiered context builder, progressive summarization, branch-diff.
- **ai-core** — agent loop, classifier, cost tracker, subagent runtime, artifact extractor.
- **tools-runtime** — 50+ tools, MCP client + OAuth, LSP client, Skills.
- **ui** — shared React hooks.
- **desktop** — the Electron app (main + renderer).

## Glossary

- **Branch** — a forkable line of conversation. Stores only its own new messages; inherits parent context by walking `parent_id` + slicing at `fork_at_index`.
- **Fork** — creating a branch at a point in another branch; inherits transcript + attached artifacts up to that point.
- **Space** — functional area inside a project (Design/Dev/Business); owns memories, artifacts, chats.
- **Artifact** — a first-class document: either *extracted* from a reply (code block, PRD…) or *uploaded* (PDF/image/docx). Can be checkbox-attached to a branch's prompt.
- **Memory** — durable facts, scoped global/project/chat/branch, stored in a JSON file, injected into prompts by specificity.
- **Knowledge graph** — the SQLite graph of significant decisions/constraints, embedded and neighbor-linked, built by the background classifier.
- **Classifier** — the background process that distills each turn into knowledge-graph nodes (API model, local fallback, enrich queue).
- **MMR (Maximal Marginal Relevance)** — reranking that balances relevance vs non-redundancy: `λ·relevance − (1−λ)·maxSimToSelected`, λ=0.7.
- **Hot window** — the most recent turns sent verbatim to the model (filtered by `turn`, not array index).
- **Tiered context / graceful degradation** — under token pressure, drop summaries → ancestry → oldest hot turns; never drop pins/artifacts/memory/retrieved.
- **Router** — resolves a model id to a provider by prefix (first-match-wins), retries, caches model lists, applies per-org key overrides.
- **Settings cascade** — global → org → project resolution (keys today; the reusable pattern for future scopes).
- **MCP (Model Context Protocol)** — open standard for connecting AI to external services; here with a full generic OAuth 2.1 client.
- **LSP (Language Server Protocol)** — powers code intelligence tools (find_definition, references, diagnostics) across 37 languages.
- **Skill** — a reusable capability as a `SKILL.md` folder; model-invoked (`<available_skills>` + `skill` tool) or user-invoked (`/name`).
- **Subagent / Delegate** — parallel-blocking vs background fan-out of sub-agents; both run a restricted tool registry.
- **BYOK** — bring your own (API) keys; the product doesn't resell tokens.
- **Codex OAuth** — key-less ChatGPT access via OAuth PKCE, impersonating the Codex CLI.
- **Branch-diff** — compares two branches' decisions (unique vs conflicting); the future "merge" primitive.

## Where things live (for "show me the code")

| Concept | File |
|---|---|
| Fork context inheritance | `packages/prompt-engine/src/context.ts` → `getAncestryMessages` |
| Tiered context + degradation | `packages/prompt-engine/src/context.ts` → `buildPayload` |
| RAG + MMR | `packages/context-engine/src/retrieval.ts` |
| Knowledge graph | `packages/graph-engine/src/graph.ts` → `MetaGraph` |
| Agent loop + guards | `packages/ai-core/src/agent.ts` |
| Subagent runtime | `packages/ai-core/src/runtime.ts` |
| Classifier | `packages/ai-core/src/classifier.ts` |
| The Router | `packages/providers/src/router.ts` |
| Codex OAuth | `packages/providers/src/codex_oauth.ts` |
| MCP client / OAuth | `packages/tools-runtime/src/mcp/client.ts`, `oauth.ts` |
| Skills | `packages/tools-runtime/src/skills/index.ts` |
| SQLite store | `packages/database/src/store.ts` |
| IPC contract | `packages/event-bus/src/index.ts` |
| chat:send flow + system prompt | `apps/desktop/src/main/index.ts` |
| Chat page | `apps/desktop/src/renderer/.../chat-page.tsx` |

## Three things to *not* over-claim (honesty guards)

1. **`code_context` isn't full tree-sitter** — it falls back to a hand-written brace/regex symbol extractor.
2. **MCP "presets" are a UI list** — the OAuth code is generic; a few presets still need real OAuth apps registered (provider-console admin, tracked as debt).
3. **`AgentSessionService`** (IDE integration) is a bespoke, non-ACP protocol and currently unwired.

## Deferred / known gaps (tracked in `context/debt.md`)

- Scanned-PDF OCR for non-Claude/Gemini models (documented escalation ladder).
- Registering AI Studio's own OAuth apps for GitHub/Slack/Figma/Google.
- Lint not wired across workspaces (~20-min fix).
- Some placeholder frontend pages (Home, Memories/Artifacts browser, Knowledge-graph view, Compare, Costs).
