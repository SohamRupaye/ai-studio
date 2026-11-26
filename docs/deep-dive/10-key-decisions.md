# 10 — Key Decisions & Trade-offs

> Each of these is a decision with a real alternative that was considered and rejected for a concrete reason — the reasoning matters more than the conclusion.

## 1. Electron desktop app (not a web app)

**Why:** The whole product is *local-first* — your context, your API keys, your knowledge graph all live on your machine in a SQLite file. That's a privacy and ownership stance ("it's *your* context"). A web app would force a server, accounts, and putting your data (and keys) on someone else's infrastructure. A desktop app also gets us **native capabilities** the product needs: spawning local tool processes (bash, MCP servers, LSP servers over stdio), local file access, and running ML models on-device.

**Cost:** ~400 MB RAM baseline. I measured this rather than assuming — it's close to Electron's structural floor (one BrowserWindow, lazy-loaded local models, no leaked DevTools). Not a leak.

**Alternative considered — Tauri:** Would cut RAM. Deliberately deferred because (a) the near-term audience is developers who already run several Electron apps daily, and (b) the migration is *contained*: only `apps/desktop`'s shell/IPC layer would be rewritten — the entire `packages/*` backend would stay as a Node sidecar. So it's a future option, not a trap.

## 2. SQLite via `better-sqlite3` (not a client-server DB, not an ORM)

**Why SQLite:** Local-first means the database ships *with* the app. SQLite is a single file, zero-config, synchronous, and fast. `better-sqlite3` is synchronous which actually simplifies the code (no async churn on every query).

**Why raw SQL, not an ORM:** The project originally had Drizzle wired in, and it was **removed** — it was never actually connected to anything and added a build/tooling surface for zero benefit. The data layer is hand-written SQL in a `Store` class. For a schema this size, hand-written SQL is more transparent and debuggable than an ORM abstraction, and migrations are explicit.

## 3. Model-agnostic / BYOK (bring your own keys)

**Why:** The product's identity is **"model-agnostic organizational intelligence."** The value is in the *context layer*, not in any one model. So it routes to Anthropic, OpenAI, Google, and Codex (ChatGPT OAuth) behind one interface, and users bring their own keys. This also sidesteps the entire "we resell tokens" business/margin problem for a pre-launch product, and it's acceptable because the audience (developers) already has keys.

**The settings cascade:** keys resolve **global → org → project**. An org can override the global keys; the router is cached per-org and invalidated when keys change. This same cascade pattern is the template for future project- and space-scoped settings — built once, reused.

## 4. Async merge model for multiplayer (not live real-time collaboration)

**Why:** The pilot's real workflow is *sequential handoff* (client → SPOC → design → dev), not simultaneous editing. That maps to **Git's async push/pull/merge**, not to Figma/Google-Docs live collab. Live multiplayer would be enormous engineering (CRDTs, presence, conflict UI) solving a problem the customer doesn't actually have. And the branch-diff logic that finds unique-vs-conflicting decisions between two branches — already built for context inheritance — is most of what a "merge" needs. So the cheaper model is *also* the better-fitting one.

## 5. Base UI over Radix (component library)

**Why:** Radix is effectively unmaintained. Base UI (from the MUI team, same headless philosophy) is the actively-maintained successor. All `@radix-ui/*` deps were removed. Behavioral logic (focus traps, keyboard nav, portals) comes from Base UI; all the *visual* styling is hand-written so the design system is fully owned.

## 6. Local embeddings (Transformers.js / MiniLM), no embedding API

**Why:** RAG retrieval needs embeddings for every message and memory. Calling an embedding API would mean (a) network latency on every turn, (b) cost, and (c) shipping your context to a third party — which contradicts the local-first promise. Instead it runs **MiniLM-L6 locally via HuggingFace Transformers.js** — the model is lazy-loaded, runs on-device, and never touches the network. Vector similarity search happens inside SQLite.

## 7. The design system is a "living system with a changelog," not a spec

**Why:** Solo project over months — the biggest risk is *forgetting my own reasoning* and re-litigating settled decisions or reintroducing fixed bugs. So both `DESIGN.md` and `ONBOARDING.md` are structured as **dated changelogs of decisions and their rationale**, and the three "hard-won gotchas" are documented specifically because violating them reintroduces bugs. This is deliberate institutional-memory engineering for a one-person team.

## 8. "Act, don't ask" agent guard

**Why:** Early on the agent would answer a question and then *offer* to do the thing instead of doing it ("If you want, I can tailor this…"). A response validator enforces "act, don't ask." But it over-fired — it flagged a *complete* long answer that ended with a friendly offer as a deflection and discarded it. The fix: the deflection check only applies to short responses (<400 chars); a real deflection is a question *instead of* an answer, not an answer *plus* an offer. Good example of a guardrail that needed a scalpel, not a hammer.

## 9. Fixture-based testing over mocks (for MCP/LSP)

**Why:** The MCP and LSP clients speak real JSON-RPC over real transports (stdio, Streamable HTTP). Mocking the transport would test my *assumptions* about the protocol, not the protocol. So the tests spawn **real local fake servers** (a fixture stdio server, a fixture HTTP server) and exercise real wire framing — real SSE parsing, real PKCE round-trips, real loopback OAuth callbacks. That's why the OAuth flow could be trusted enough to graduate off the "untested" list.

## Trade-offs I'd flag honestly (shows maturity)

- **Lint isn't wired up** across workspaces yet (missing flat configs) — known, ~20-min fix, tracked in `context/debt.md`.
- **Scanned-PDF OCR** is deferred for non-Claude/Gemini models — there's a documented escalation ladder and a concrete pickup trigger rather than building it speculatively.
- **Some files remain untested** (the subagent orchestrator, the default registry wiring) — explicitly listed with severity, not hidden.
- **A few OAuth presets (GitHub/Slack/Figma/Google) need me to register real OAuth apps** — the *code path* is done and tested; the remaining work is provider-console admin, tracked as debt.

**The pattern across all of these: deliberate deferral with a written trigger**, tracked in `context/debt.md` — the "later" list — separate from `plan.md`, the "now" list.
