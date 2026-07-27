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

## Claude subscription engine via the Agent SDK — BUILT 2026-07-25, ship-gated on Anthropic approval

**Status: implemented behind an off-by-default config flag. Do NOT enable in a shipped build until the policy gate below clears.** The code is complete and tested; the blocker is permission, not engineering.

### The policy state (verified 2026-07-25 — supersedes the 2026-07-18 note)

The 2026-07-18 entry claimed an **Agent SDK credit** made this sanctioned. That was written against an announced change which has since been pulled. Two primary sources, both checked directly:

1. **The credit programme is paused.** Anthropic's help centre article "Use the Claude Agent SDK with your Claude plan" opens with: *"We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed."* No active implementation date. (Announced amounts, for when/if it lands: Pro $20, Max 5x $100, Max 20x $200, Team standard $20 per month; on exhaustion, requests stop unless the user enabled pay-as-you-go.)
2. **The standing rule still requires prior approval.** The Agent SDK docs say verbatim: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login **or rate limits** for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods described in this document instead."*

Note the "**or rate limits**" clause — it plausibly covers consuming a user's subscription quota on behalf of your product even when you never render a login. Read that as: we are the case the rule is aimed at.

**Today's economics, if it were permitted:** Agent SDK usage on a local Claude Code login draws the user's *normal* Claude Code subscription limits, not a $20 credit. The credit is the future *restriction*, not the present state. So the value proposition is currently better than the paused-programme numbers suggest, and the ceiling is a risk to design around rather than a limitation to live with.

### Why boop is not precedent

[raroque/boop-agent](https://github.com/raroque/boop-agent) (re-read 2026-07-25) does this in the open and is unaffected — but it is not a transferable comparison:

- **It implements no auth at all.** `server/runtimes/claude.ts` has zero credential code: no OAuth, no token storage, no key, no credential-file reads. It calls `query()` and lets the SDK resolve whatever Claude Code wrote. Its README: *"Install the matching CLI, sign in once, Boop uses your local session."*
- **It is a self-hosted template, not a distributed product** — MIT source you clone and run, bring-your-own Sendblue/Composio keys, ngrok. Its own README draws our line for us: *"If you'd prefer Claude API-key billing (e.g. for a deployed server), set `ANTHROPIC_API_KEY`."*
- **It is unenforceable-against, not blessed.** Its SDK requests are indistinguishable from Claude Code's own; there is no binary, listing, or service to act on. Squirl is a signed, packaged, forge-built app — identifiable and enforceable in a way a template repo is not. Risk scales with distribution, and we have the thing boop lacks.

### What was built (the local-session model, not "Sign in with Claude")

The key design change from the 2026-07-18 plan: **we do not implement sign-in.** No OAuth flow, no registered client id, no token storage, no refresh — the deleted half of the original plan. The user signs into Anthropic's own Claude Code; the SDK picks that up. This drops the entire mirror of `CodexOAuthProvider` (`login`/`logout`/`switchAccount`/`auth.json`/refresh mutex/JWT parsing) and is a materially easier thing to ask approval for.

- `packages/ai-core/src/engines/claude-sdk.ts` — the engine. One `query()` per turn, our payload serialized in, SDK session management bypassed. Maps SDK messages → `AgentStreamEvent`.
- `packages/ai-core/src/engines/json-schema-to-zod.ts` — **required, not incidental.** `tool()` accepts only a Zod raw shape (`AnyZodRawShape`), while all ~60 registry tools are JSON Schema. That shape is what the model sees, so a permissive passthrough would blind it to every parameter.
- `packages/ai-core/src/engines/local-session.ts` — existence-only login detection. Never reads a credential value; never passes `-g` to `security find-generic-password` (that flag prints the secret).
- `packages/ai-core/src/engine.ts` — `runTurn` dispatcher. Native loop stays the default; SDK engine requires enabled flag **and** a bare `claude*` model id **and** a detected session, else falls back to native with a stated reason.
- `apps/desktop/src/main/ipc/chat.ts` — single call-site swap (`runAgentCooperative` → `runTurn`).
- Config `claude_subscription_engine` (off by default), `claude-session:status` IPC (status only — deliberately no `login` counterpart), and a toggle row in `/settings/providers` → Accounts.
- Tests: `json-schema-to-zod.test.ts` (12), `claude-sdk-engine.test.ts` (8).

**Non-obvious decisions worth keeping:**
- `tools: []` disables every SDK built-in. Without it the model can Bash/Write outside Squirl's tool system, bypassing approval cards and snapshots entirely — a safety hole, not a cosmetic one.
- `settingSources: []` is the SDK's isolation mode. Without it the CLI's defaults apply and the *user's* `~/.claude/CLAUDE.md` and skills leak into Squirl turns, corrupting what the prompt engine assembled.
- `env` **replaces** the subprocess environment rather than merging, so `process.env` is spread explicitly — and `ANTHROPIC_API_KEY` is stripped on purpose, so a key on the machine can't silently get billed when the user asked for subscription auth.
- `apiKeySource` on the SDK's `system`/`init` message is the authoritative auth signal, but it describes where an API **key** came from — under a local Claude Code login there is no key and the SDK reports **`"none"`** (verified against SDK 0.3.220: a `"none"` turn completes normally; `"none"` isn't in the declared `ApiKeySource` union). The guard is therefore a **deny-list** on `user`/`project`/`org`/`temporary` — the sources that mean a real key is billed. An allow-list on `"oauth"` was the first implementation and it rejected every genuine subscription turn. Filesystem detection is only a UI heuristic.
- `CLAUDE_AGENT_SDK_CLIENT_APP` is set to `squirl/<version>` — the SDK's sanctioned way to identify a third-party consumer, and the opposite of what `codex_oauth.ts` does (see below).
- Tool names are stripped of the `mcp__squirl__` prefix before any event escapes the engine; the renderer, `redactToolArgs`, persisted rows and `validateResponse`'s write-tool list all key on bare ids.

### Known gaps (accepted, not fixed)

- **The hallucination guard does not run on SDK turns.** `validateResponse` works by pushing a rejected draft plus a correction into `history` and re-entering the loop; the SDK owns its loop and exposes no such seam. Structural, not an oversight.
- **ContextStats become a claim.** They're captured pre-flight in `chat.ts`, so the right panel still renders numbers — but they describe what Squirl *sent*, not what the model saw. The SDK may compact or inject on its own.
- **History images degrade.** The SDK prompt is a single user message, so only the latest turn keeps native image/document blocks; earlier turns serialize to text via `contentToText` and their images become `[image]`.
- **No per-turn cost.** `AgentResult.cost` is left unset: on subscription auth nothing is billed per token, so surfacing the SDK's `total_cost_usd` as a charge would be a lie. Token usage is consequently not surfaced either.
- **App size: +249 MiB** measured on install (`@anthropic-ai/claude-agent-sdk` 0.3.220 plus its per-platform native binary). Forge packaging impact is real and unaddressed.
- SDK subagents/Task are not used; Squirl's own `runtime.ts` delegates stay on the native loop.

### Ship gate

**Do not enable by default, and do not market it, until Anthropic grants the "previously approved" exemption.** Ask about *this* shape specifically — a toggle over a user's existing local Claude Code login, with no login surface of our own — not about an OAuth flow. That is a much easier yes and is the shape boop demonstrates works technically.

Related: `codex_oauth.ts` sends `originator: "opencode"` and `User-Agent: opencode/latest` — it authenticates as a different client. Whether that violates OpenAI's terms is unverified, but it is the same category of unsanctioned subscription passthrough and it already ships. A public subscription-auth push invites scrutiny of that pattern; review it rather than treating it as precedent.

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
