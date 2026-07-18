# debt.md — deliberate deferrals

Known gaps we chose not to build yet, each with the context to decide later and a concrete trigger for picking it up. Add entries when work is consciously parked; delete them when done or obsolete. This file is the "later" list — `plan.md` is the "now" list.

## Scanned-PDF coverage beyond Claude/Gemini (OCR) — parked 2026-07-10

**Current state:** scanned (image-only) PDFs are accepted at upload (blob preserved, placeholder text, caveat toast). On models with native PDF input (Claude, Gemini — gated by `supportsPdfInput()` in `packages/tokenizer`) they ride as document blocks and the provider OCRs server-side, so they just work. On every other model the context carries an honest `[Scanned PDF — no extractable text layer…]` placeholder.

**Who's in the gap:** users on a non-Claude/Gemini model attaching scanned PDFs. Most of those models still have vision, just not PDF input.

**Agreed escalation ladder (build in this order, only as far as demand requires):**
1. **Page rasterization → image blocks** for vision models without PDF support (GPT-4o/4.1, o-series, Pixtral, Qwen-VL…). No OCR dependency; a vision model reading page images beats tesseract on messy scans. The bulk of the work is a pdf.js page renderer in a hidden BrowserWindow (main process has no canvas) — and that renderer is the shared prerequisite for every later step. Also improves layout-heavy *regular* PDFs on those models.
2. **True OCR for text-only models**, only if that intersection materialises. Options weighed: macOS Vision framework bindings (fast, high quality, per-OS native code) vs tesseract.js (cross-platform WASM, ~10–15MB lang data, 1–5s/page, mediocre on real scans) vs one-time vision-model transcription stored into the artifact content (paid once, reuses the provider layer). Note: OCR at upload time breaks the synchronous upload flow — needs background jobs + progress UI + cancellation.

**Pickup trigger:** a user on a non-Claude/Gemini model actually reports a scanned PDF they need read. Until then, the honest placeholder is doing its job.

## Register AI Studio's own OAuth apps for MCP presets — parked 2026-07-11

**Current state:** MCP OAuth works end-to-end, but four preset services don't allow dynamic client registration, so their quick-connect can't sign in with zero setup the way Notion/Linear/Sentry/etc. do. Each install currently needs the user's own credentials:
- **GitHub / Slack** — no DCR at their IdPs; users connect with a PAT ("Use token") or paste their own OAuth app via the "OAuth client" action.
- **Figma** — has a registration endpoint but 403s non-allowlisted apps.
- **Google Workspace (Gmail / Calendar / Drive presets, shipped 2026-07-11)** — users create a Google Cloud OAuth client (Desktop app type) and paste it into the connect dialog; sign-in then runs in the browser. The same client covers all three servers, but has to be pasted per server.

**The fix is administrative, not code:** register an OAuth app for AI Studio with each provider and bake the client ids into `MCP_PRESETS` (the `oauth` block on `MCPServerConfigEntry` and `ensureClient`'s prefer-explicit-client path already support it — that's exactly how Dia/VS Code connect). Per provider:
- **GitHub**: create an OAuth App (github.com/settings/developers), callback `http://127.0.0.1:19876/callback`. Minutes.
- **Slack**: create a Slack app with the MCP user scopes; note Slack splits `scope`/`user_scope` params — may need a small flow tweak on first test.
- **Google**: create the OAuth client, then pass **Google's app verification for the sensitive Gmail/Drive scopes (CASA security assessment — takes weeks, budget for it)**. Until verified, third-party users hit the "unverified app" interstitial with a 100-user cap.
- **Figma**: apply for their MCP client allowlist (registration is gated).

**Pickup trigger:** before launch / first external users — an unregistered app means every user does provider-console setup the product should have done once. Google's verification lead time (weeks) makes it the one to start first.

**Composio evaluated as an alternative (2026-07-18) — rejected as a replacement.** Composio's managed auth (they register the OAuth apps, store/refresh user tokens in their cloud) would clear this debt on paper, but: (1) it needs an org-level Composio API key, which in a distributed no-server desktop app must ship in the binary — anyone extracting it can hit any `user_id`'s connected accounts; their model assumes a backend we deliberately don't have. (2) Whitelabeling the consent screen ("Composio wants to access…") requires bringing your own OAuth apps — i.e. exactly this debt, plus a vendor. (3) Per-tool-call pricing (20K/mo free, then $29/mo+) for something we do free, and it breaks the "your tokens never leave your machine" story. It DOES work today with zero code as a power-user path: paste a Composio MCP server URL into Add custom server (`x-api-key` via config.yaml headers, same trust boundary as PATs). Revisit as a connector-long-tail buy option only if/when the multi-user server phase gives us a backend to hold the key.

## "Sign in with Claude" — Claude subscription engine via the Agent SDK — parked 2026-07-18

**Current state:** the Anthropic provider is BYOK raw API (`packages/providers/src/anthropic.ts`, no `@anthropic-ai/*` deps anywhere); `codex_oauth.ts` already gives ChatGPT subscribers subscription-authenticated inference. Claude subscribers pay per token — the asymmetry is real and visible.

**Why it's possible (verified 2026-07-18):** plain subscription OAuth passthrough is banned for third-party apps (Anthropic Commercial Terms, Feb 2026), BUT June 2026 introduced an **Agent SDK credit**: Pro/Max/Team subscribers claim a separate monthly credit covering "third-party apps built on the Agent SDK". The sanctioned shape is therefore an engine built on `@anthropic-ai/claude-agent-sdk` — NOT a codex_oauth-style raw-API clone.

**Reference implementation: [raroque/boop-agent](https://github.com/raroque/boop-agent)** (read 2026-07-18, clone was in scratchpad). Its `server/runtimes/` (~800 lines) demotes both Claude Code and Codex to subscription-authenticated inference+tool-loop engines: common `RuntimeRunRequest` (prompt/systemPrompt/tools/streaming callbacks), Claude adapter is 122 lines — Agent SDK `query()` with **app tools injected via `createSdkMcpServer` (in-process MCP)**, built-ins suppressed, `permissionMode: bypassPermissions`, identity overlay in the system prompt. Proves the shape works and the adapter is small.

**The work if picked up (~1.5–2.5 weeks, not a rewrite):** engine seam where `chat:send` invokes `agent.run` (native loop stays the default for every provider; Codex needs nothing — codex_oauth already covers it); SDK event mapping onto `AgentStreamEvent` (text/thinking/tool_start/tool_end/usage) so the whole transparency stack rides unchanged; tool bridge from our registry (already function-shaped); per-turn one-shot `query()` with our prompt-engine payload serialized in (bypass SDK session management deliberately — branches/memories/artifacts are our product); disable the SDK's own Task/subagents in v1; "Sign in with Claude" row in `/settings/providers` mirroring Codex. Costs: the SDK bundles a native Claude Code binary (app size + forge packaging), and SDK turns weaken the right panel's "what will the model see" honesty + skip the hallucination guard unless re-mapped.

**Why parked:** permanent two-loop drift tax on the differentiating layer (tool transparency, thinking, subagent transcripts, timeouts — each re-built or silently different on SDK turns); policy ground moved twice in six months and the credit mechanics for third-party apps are unverified by us; the validated pilot user is an org already covered by org-level API-key overrides — subscription auth serves the post-launch individual funnel, which doesn't exist yet. Deliberately do NOT pre-build the engine seam — cut it when the second engine actually lands (boop shows it's cheap to cut then).

**Pickup trigger:** post-launch, individual (non-org) users demonstrably bouncing off BYOK, AND a hands-on verification that the Agent SDK credit works for a third-party desktop app (claim flow + auth handshake in packaged Electron).

## Boop steals we deliberately skipped — parked 2026-07-18

Landed five patterns from raroque/boop-agent (see `context/plan.md`); these four we consciously left. Each is small on its own; none is worth building before its trigger.

- **Memory decay / soft-archive.** We shipped dedup-on-add only. Boop scores memories `importance × decay × reinforcement` and archives/prunes on a timer, plus a daily proposer→adversary→judge consolidation pass. We have no importance/accessCount/lastUsed fields on `MemoryFact` (it's a flat JSON store) and nothing ages or merges. **Trigger:** a heavy user's memory panel turns to noise (near-dups that dedup didn't catch, stale facts crowding the prompt). Build order: add the fields + a decay sweep on the existing scheduler first; the adversarial consolidation is the fancy version to grow into. Nothing should ever HARD-delete (product ethos) — archive = excluded-from-prompt + restorable.
- **Per-agent retry button.** The subagent drawer (`chat/subagents.tsx`) is read-only; a failed/timed-out delegate can't be re-run from the UI. Needs a new IPC to re-invoke `runTask` for one `agentId` with its stored task/model, plus persisting the `allowedTools` allowlist + runId on the record (not stored today) so the call can be reconstructed. **Trigger:** users actually hitting failed delegates and wanting a one-click redo (vs. re-asking in chat).
- **Browser screenshots + login-handoff.** Our browser tools are string-result only (aria snapshots, text) — no screenshot tool (results are strings; would need an image-block path) and no explicit "I've opened a browser, log in, then I'll continue" handoff prompt (boop gates that separately from automation). **Trigger:** the first real user driving a visual/login-heavy browser flow who needs to see the page or hand off a manual login.
- **Proactive triggers.** Boop's webhook-driven Gmail watcher (classify inbound mail → ping the user) is its most magical demo, but it depends on a publicly reachable webhook endpoint Composio fires at — a local-first app has no webhook surface. **Trigger:** automations prove valuable AND there's demand for event-driven (not just scheduled) proactivity; the local shape would be a polling automation that classifies + notifies, not a webhook.

## Lint is not running anywhere — pre-existing, surfaced 2026-07-09

`yarn lint` cannot pass: workspaces have `lint: "eslint src/"` scripts but no `eslint` devDependency and there are **no `eslint.config.*` files in the repo** (ESLint 9 needs flat configs; `tooling/eslint` exports one nothing consumes). The occasional turbo "pass" is a stale cache replay. Fix is ~20 minutes: add `eslint` + `@squirl/eslint-config` as devDeps where the script exists, add per-workspace `eslint.config.js` importing the tooling config.

**Pickup trigger:** before relying on CI lint as a gate, or the next "chore: lint" pass.

## Capability predicates live in the tokenizer package — cosmetic

`supportsVision()` / `supportsPdfInput()` are model-capability metadata, not tokenization, but moving them to `@squirl/shared` would add a new cross-package dependency for a purely cosmetic relocation. Leave until something else forces a `shared` dependency in `tokenizer`.
