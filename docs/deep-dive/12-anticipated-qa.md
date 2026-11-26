# 12 — Anticipated Questions & Answers

> Likely questions this project raises, with compressed answers — expand with detail from the other deep-dive files. Grouped by topic.

## Product / "why does this exist?"

**Q: What is it, in one sentence?**
A: "Git for AI-native work" — a desktop app where context, not chat, is the primary object; it accumulates a project's knowledge and lets you branch/fork conversations like code so you never re-explain yourself to an AI.

**Q: What problem does it actually solve?**
A: Every AI conversation starts from zero. You re-paste context into ChatGPT, then into Claude, then your teammate does it again in their tool. I validated this with an 18-person startup whose workflow is client → SPOC → design → dev — every handoff re-explains the whole project to a different person's AI. AI Studio makes context a durable, shareable object instead of something trapped in throwaway chat windows.

**Q: Who's the user and what's the business model?**
A: Near-term: developers, single-user, local-first, BYOK (bring your own API keys) — so no token-reselling margin problem pre-launch. Later: async team handoff (Git-style push/pull), not live multiplayer.

**Q: Why not just use ChatGPT / Claude Projects / Cursor?**
A: Those treat the conversation as the product. AI Studio treats *accumulated context* as the product — with real branching/forking, a queryable knowledge graph of your decisions, cross-branch retrieval, and model-agnostic routing. It's the layer *above* any single model.

**Q: Is this real or a demo?**
A: The backend is complete and hardened — MCP, LSP, RAG, the knowledge graph, the agent loop are all tested implementations, not scaffolding. The design system, component library, app shell, settings, and the full chat page are built. A few destination pages are still placeholders. It's pre-launch, validated against one pilot.

## Architecture

**Q: Walk me through what happens when a user sends a message.**
A: (This is the money question — narrate the end-to-end flow.) Renderer sends `chat:send` over typed IPC → main resolves the branch → project → org to get the right per-org router with that org's keys → `buildPayload` assembles tiered context (memory, ancestry, summaries, RAG-retrieved knowledge, pins, attached artifacts) that degrades gracefully if over budget → the agent loop streams from the provider, executes any tool calls, loops → every token/tool/subagent event streams back over `chat:stream` tagged with a `branchId` → the reply, costs, and context stats are persisted, artifacts extracted, and a background classifier distills the turn into new knowledge-graph nodes. That one flow touches almost every package.

**Q: Why a monorepo? Why these package boundaries?**
A: Clean layering and dependency discipline — types and the IPC contract at the bottom, then persistence + knowledge, then the provider boundary, then context intelligence, then execution, then the app. The boundaries force good decisions, e.g. `tools-runtime` can't import `ai-core`, so delegation is dependency-injected.

**Q: How is the frontend/backend boundary kept in sync?**
A: One file (`event-bus`) declares every IPC channel as a typed tuple `[Request, Response]`, and a generic `window.ipc.invoke<C>` bridge makes every call statically typed. The two sides literally can't drift — a wrong payload fails to compile.

## The context engine (the deepest questions land here)

**Q: How do you decide what context to send the model?**
A: A tiered assembly — hierarchical memory, inherited fork ancestry, conversation summaries, RAG-retrieved knowledge-graph hits, pinned rules, and explicitly-attached artifacts. Each block carries an instruction on how much to trust it. If it exceeds the context window, I drop in priority order: summaries first, then ancestry, then oldest recent turns — but *never* pins, attached documents, memory, or retrieved knowledge. Explicit user intent outranks machine recall.

**Q: How does retrieval work?**
A: A background classifier turns each significant turn into a node in a local SQLite knowledge graph, embedded with MiniLM (local, no network). On each query I embed it, do a similarity search, expand to graph neighbors, and rerank with MMR (λ=0.7) so results are relevant *and* non-redundant. Cross-branch hits are tagged with their origin branch.

**Q: What's MMR and why use it?**
A: Maximal Marginal Relevance. Greedily pick the candidate maximizing `λ·relevance − (1−λ)·maxSimilarityToAlreadyPicked`. It stops you from returning three paraphrases of the same decision — you get diverse, relevant context. λ=0.7 leans toward relevance.

**Q: How does branching preserve context?**
A: A branch stores only its own new messages. Full context is reconstructed lazily by walking `parent_id` up the chain and slicing each ancestor at the child's `fork_at_index` — so a fork inherits exactly the context that existed at the fork point. Same walk feeds both the prompt and the UI, so what the user sees is what the model gets.

**Q: How would this scale to a huge knowledge graph?**
A: Today it's a full table scan per query and O(n²) inserts — deliberately simple, fine for per-project scale (hundreds to low-thousands of nodes; a dot product over 384 floats is trivial). To scale: an ANN index (sqlite-vss / FAISS / HNSW) and a proper indexed "nodes-by-branch" query.

**Q: Why local embeddings instead of an embedding API?**
A: Privacy (local-first — nothing leaves the machine), no per-turn latency or cost, no third-party dependency. Trade-off: MiniLM is less accurate than a hosted model, which is fine for topic-level retrieval.

**Q: You said memory doesn't go stale — how does that actually work?**
A: `GlobalMemory` (the `remember`-tool store, separate from the classifier's knowledge graph) used to be a flat, deduped fact list — so a fact that *changed* rather than repeated verbatim ("works at Google" → "joined Stripe") just sat there alongside its own contradiction forever, with no recency signal. Now facts carry a lifecycle and typed edges: a detected contradiction adds an `updates` edge, flipping the old fact to `superseded` (never deleted — restorable history) so an `isLatest` view returns only the current one. Detection is tiered (cloud LLM when routable, else a local zero-shot NLI model shared with the classifier — never depends on a cloud model surviving) and requires two agreeing signals before hiding anything, since a false positive there is destructive. A `preference` fact reinforces instead of duplicating on restatement; an `episode` expires past its date. Everything is soft — status flags, never hard deletes.

**Q: Doesn't that clash with the branching model — what if two forks disagree?**
A: That's exactly why supersession is scoped to **branch ancestry**, not global. `isLatest` resolves against the same parent-chain walk used to reconstruct a fork's context, so a correction made on one branch only takes effect for that branch and its descendants — a sibling fork that forked before the correction still sees the original fact. It's the same reason hosted single-timeline memory products (Zep, Mem0, Supermemory) can't do this: they have no concept of a fork to scope "latest" to. It's also the seed of branch-merge-as-conflict-resolution later — reusing the unique-vs-conflicting-decision logic branch-diff already computes.

## Providers & models

**Q: How do you support multiple LLM providers?**
A: Every provider implements a 2-3 method interface (`call`, `stream`, optional `listModels`), with a pure converter mapping neutral content blocks to each vendor's wire format. A Router resolves a model id to a provider by prefix (first-match-wins), retries with backoff, caches model lists for an hour, and applies per-org key overrides.

**Q: How does Codex/ChatGPT work without an API key?**
A: OAuth PKCE against ChatGPT, impersonating the official Codex CLI — a local loopback server catches the redirect, tokens are cached and refreshed with a mutex so concurrent refreshes don't race the rotating refresh token, and the undocumented model endpoint is queried without ever triggering an interactive login (since it runs from a background refresh).

**Q: What happens when a provider fails?**
A: Retry up to 3× with exponential backoff on retryable errors (429/5xx/network), classified by the error message. Abort short-circuits retries. Model lists fall back to a hardcoded catalogue. No silent cross-provider failover — surprising users with a different model is worse than a clear error.

## Agent & tools

**Q: How does the agent loop work / when does it stop?**
A: Stream from the model; if it calls tools, run them and feed results back; repeat until no tool calls or a `maxIterations` cap (10). Two guards: a "deflection" guard that nudges the model to act instead of asking (only on short responses, to avoid killing good long answers), and a "fabricated action" guard that catches the model claiming edits it never made via a write tool.

**Q: How do subagents work / how do you prevent infinite recursion?**
A: `subagent` fans out up to 4 in parallel (blocking); `delegate` runs one in the background. Each gets a *restricted* tool registry with the delegation tools removed, so a subagent can't spawn subagents. Hard timeouts with an abort backstop that works even if the provider ignores the signal.

**Q: How does MCP OAuth work?**
A: Fully spec-driven, not per-provider. RFC 9728 discovery from the 401 → RFC 8414 metadata → RFC 7591 dynamic client registration as a public client → PKCE S256 over a one-shot loopback server → code exchange with resource indicators → silent refresh on later 401s. Tested against a fixture server that actually recomputes the PKCE challenge.

## Engineering practice

**Q: How do you test wire protocols like MCP/LSP?**
A: Fixture-based integration tests, not mocks — real local fake servers that implement the RFCs and recompute PKCE. Mocking would test my assumptions about the protocol; a real server tests the protocol.

**Q: What's a hard bug that got fixed?** *(see `11-hard-problems-solved.md`)*
A: The model had amnesia about its own tool calls — I asked "what commands did you run?" and it denied running any. Root cause: tool calls were stored for the UI but never re-entered the model's context, and we didn't even persist the arguments. Fixed by reattaching a compact tool trail to the assistant text the model sees. Found it by *using* the product; regression-tested it.

**Q: How do you keep a solo, multi-month project maintainable?**
A: Both `ONBOARDING.md` and `DESIGN.md` are dated decision-logs — every change records *why*, not just what. The hardest-won gotchas are documented specifically because violating them reintroduces fixed bugs. A separate `debt.md` tracks deliberate deferrals with concrete pickup triggers. It's institutional memory for a team of one.

## Curveballs

**Q: Why Electron? Isn't it heavy?**
A: Local-first needs native capabilities — spawning tool processes, file access, on-device ML. RAM is ~400 MB, which I measured to be near Electron's structural floor, not a leak. Audience is developers who already run Electron apps. Tauri is a contained future option — only the shell/IPC layer would change; the backend stays a Node sidecar.

**Q: What's the weakest part / what would change?**
A: The knowledge graph's O(n²) inserts and full-scan retrieval will need a real vector index before big graphs. Lint isn't wired across workspaces yet. Some main-process handlers lack a test harness. And a few OAuth presets need real registered apps. All tracked, none load-bearing yet.

**Q: With a team, what would get built next?**
A: The async team handoff — push/pull/merge between Spaces — because the branch-diff engine (unique vs conflicting decisions) is already most of a merge. That's the multiplayer story the pilot actually needs, and it's an extension of what exists, not a rewrite.

**Q: How is any of this different now that models have huge context windows?**
A: Bigger windows don't solve *the wrong context* or *stale context* or *cost* — stuffing 1M tokens every turn is slow and expensive and dilutes attention. Retrieval + tiering sends the *right* few thousand tokens. And branching/knowledge-graph/handoff are about *organizing* context across sessions and people, which no context window addresses.
