# AI Studio (Squirl) — Engineering Deep-Dive

> A guided tour of the project for anyone who wants to understand it inside-out — contributors, reviewers, or anyone curious how it's built. Written in a mix of plain-English and technical depth: each doc explains *what it is and why it matters* before *how it works*.

## How this was built

These docs were assembled by reading the entire codebase (12 packages, ~40k lines) plus the living project docs (`context/ONBOARDING.md`, `context/DESIGN.md`, `context/debt.md`). Where a doc says "regression-tested" or cites a file, it's from the actual source — not invented. Cross-check anything against the code if you're relying on it.

## Where to start

1. **`01-the-pitch.md`** — the story, the problem, the vision.
2. **`05-context-engine.md`** — the flagship differentiator and the deepest technical content.
3. **`12-anticipated-qa.md`** — common questions this project tends to raise, with answers.

Then skim **`14-quick-facts-and-glossary.md`** for a quick reference of numbers, names, and terms.

## Full reading order

| # | Doc | What it covers | Good for |
|---|---|---|---|
| 01 | [The Pitch](01-the-pitch.md) | Problem, vision, "git for AI context", product sequencing, status | "What is this?" / non-technical framing |
| 02 | [Architecture Overview](02-architecture-overview.md) | Monorepo, 12 packages, layering, end-to-end request flow | "How's it put together?" |
| 03 | [Data Model & Persistence](03-data-model.md) | Org→project→space→chat→branch, SQLite, **branching/forking**, migrations | "How does branching AI context work?" |
| 04 | [Providers, Routing & Models](04-providers-and-models.md) | Multi-provider abstraction, the Router, Codex OAuth, streaming, tokenizer | "How does it support multiple LLMs?" |
| 05 | [The Context Engine](05-context-engine.md) ⭐ | Knowledge graph, RAG + MMR, tiered prompt, graceful degradation, branch-diff | The flagship — the deepest technical content |
| 06 | [Agent Loop & Subagents](06-agent-loop-and-subagents.md) | Tool-call loop, guardrails, delegation, timeouts, classifier, costs | "How does the agent work?" |
| 07 | [Tools, MCP, LSP & Skills](07-tools-mcp-lsp-skills.md) | 50+ tools, the MCP **OAuth 2.1** flow, 37-language LSP, skills system | "How does MCP OAuth work?" |
| 08 | [The Desktop App](08-desktop-app.md) | Electron main/renderer/preload, IPC security, the `chat:send` flow, config | "How's the Electron app structured?" |
| 09 | [Frontend & Design System](09-design-system.md) | React 19, Base UI, warm-mono design system, the chat page, gotchas | UI and design decisions |
| 10 | [Key Decisions & Trade-offs](10-key-decisions.md) | Why Electron/SQLite/BYOK/Base UI/async-merge/local-embeddings | "Why was it built that way?" |
| 11 | [Hard Problems Solved](11-hard-problems-solved.md) | 10 real bug/challenge stories with root causes and fixes | Notable debugging stories |
| 12 | [Anticipated Q&A](12-anticipated-qa.md) | Likely questions and answers, grouped by topic | Quick reference |
| 13 | [Demo Script](13-demo-script.md) | Beat-by-beat live walkthrough + fallbacks | For a live demo |
| 14 | [Quick Facts & Glossary](14-quick-facts-and-glossary.md) | Numbers, names, one-liners, where-things-live | Quick reference |

## The one thing to internalize

Everything ladders up to a single idea: **context, not chat, is the primary object.** The product forks it (git), retrieves it (knowledge graph + RAG), controls it (tiered prompt + inspector), and will one day hand it off (async merge). Every deeper detail ties back to that thesis — it's what turns "another AI chat app" into "a new category."

## Honesty guards (don't over-claim)

Be precise about what's done vs. deferred:
- Backend is complete + tested; several **frontend pages are still placeholders**.
- **`code_context` isn't full tree-sitter** (regex/brace fallback).
- **MCP "presets" are a UI list** — the OAuth code is generic; a few presets still need real registered OAuth apps (provider-console admin, tracked in `context/debt.md`).
- The knowledge graph uses **full-scan retrieval / O(n²) inserts** — fine per-project, needs a vector index to scale.
- **Lint isn't wired** across workspaces yet.

These are all tracked in `context/debt.md` with concrete pickup triggers.
