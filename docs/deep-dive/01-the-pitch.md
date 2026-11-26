# 01 — The Pitch (Problem, Vision, Product)

> Read this first — the answer to "so what is this?" is here. This file is deliberately light on code — it's the *why*.

## The one-liner

**AI Studio is "Git for AI-native work."** It's a model-agnostic desktop app where **context — not chat — is the primary object.** It accumulates the knowledge, decisions, reasoning, and artifacts of a project so you never have to re-explain yourself to an AI again, and it lets you **branch and fork a conversation's context** the same way you'd branch code.

If you can only remember one sentence, remember that one.

## The problem (say it as a story)

Everyone now works *with* AI, but every AI conversation starts from zero. You paste the same background into ChatGPT on Monday, re-paste it into Claude on Tuesday, and your teammate pastes a third version into their tool on Wednesday. The context lives in your head and in throwaway chat windows, not in the project.

I validated this against a real **18-person startup pilot**. Their actual workflow is a chain of handoffs:

> **client → SPOC (single point of contact) → design → development**

At every arrow, someone re-explains the whole project to a *different* person whose AI has *different* context. The client sends docs to the SPOC; the SPOC briefs design; design hands off to dev. Nobody's AI shares what the previous person's AI already figured out. That re-explanation tax is the pain point — and the pilot confirmed it's real for them.

## The insight

Software teams solved "many people working on a shared, evolving thing" **thirty years ago** — it's called Git. Branches, forks, history, merges. AI-native work has the same shape (parallel exploration, handoffs, "let me try a different approach") but no equivalent tool. So AI Studio borrows Git's mental model and applies it to *context* instead of code.

- A **branch** is a line of conversation you can fork at any point — the fork inherits all the context up to that point, exactly like `git branch`.
- **Memory, decisions, and artifacts** accumulate at the project level and get retrieved automatically, so context compounds instead of evaporating.
- Handoffs between people map to Git's **async push/pull**, not to live real-time editing.

## Who it's for (and the sequencing — don't relitigate this)

This ordering is **decided and validated**, not up for debate without a real reason:

1. **Ship the single-user product first** — "Git for my *own* AI context." This is what's built today: local SQLite database, no server, **BYOK** (bring your own API keys). A developer runs it on their machine and never loses context across sessions.
2. **Multi-user comes later, as async push/pull/merge — explicitly NOT live real-time multiplayer.** The pilot's real workflow is *sequential handoff* (client → SPOC → design → dev), which maps to Git's async model, not to Figma/Google-Docs-style simultaneous editing. Crucially, the engine that already finds unique-vs-conflicting decisions between two branches (the "branch-diff" logic in the prompt engine) is *most of what a merge would need* — so multi-user is an extension of what exists, not a rewrite.

The near-term audience is **developers**, which is why an Electron desktop app is fine (they already run several Electron apps daily) and why BYOK is acceptable (they have API keys).

## Status (be honest and precise)

- **Started:** 2026-05-27. **Solo-built.** ~40k lines of TypeScript across 12 packages.
- **Backend:** complete and hardened — not scaffolding. MCP client, LSP client, RAG retrieval, local knowledge graph, hierarchical memory, the agent loop, and multi-provider routing are all real, tested implementations.
- **Frontend:** design system + 31-component library + app shell + settings + the full chat page are built and working. A handful of destination pages (Home, Memories/Artifacts browser, Knowledge-graph view, Compare, Costs) are still placeholders.
- **Stage:** pre-launch, validated against the one pilot customer.

## The domain model in one breath

**Organisation → Project → Space → Chat → Branch.**

- An **Organisation** groups projects and can hold its own API keys.
- A **Project** is a body of work.
- A **Space** is a functional area inside a project — **Design / Development / Business** — which map *exactly* to the pilot's handoff boundaries. Each Space owns its memories, artifacts, and chats. Spaces are also the intended future unit of person-to-person handoff.
- A **Chat** is a container. You never work "in a chat" directly — you always work **on a branch** (Git semantics). Every chat has a `main` trunk branch by invariant.
- A **Branch** is a single line of conversation you can fork, rename, export, and (later) merge.

## Why the name "AI Studio" and the "git for context" framing lands

It reframes the whole category. Chat tools treat the *conversation* as the product and throw it away. AI Studio treats the *accumulated context* as the product — the conversation is just how you add to it. That's the pitch, and it's also literally how the code is organized: the biggest, most-tested packages are the ones that *manage context*, not the ones that talk to models.
