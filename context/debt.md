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

## Lint is not running anywhere — pre-existing, surfaced 2026-07-09

`yarn lint` cannot pass: workspaces have `lint: "eslint src/"` scripts but no `eslint` devDependency and there are **no `eslint.config.*` files in the repo** (ESLint 9 needs flat configs; `tooling/eslint` exports one nothing consumes). The occasional turbo "pass" is a stale cache replay. Fix is ~20 minutes: add `eslint` + `@ai-studio/eslint-config` as devDeps where the script exists, add per-workspace `eslint.config.js` importing the tooling config.

**Pickup trigger:** before relying on CI lint as a gate, or the next "chore: lint" pass.

## Capability predicates live in the tokenizer package — cosmetic

`supportsVision()` / `supportsPdfInput()` are model-capability metadata, not tokenization, but moving them to `@ai-studio/shared` would add a new cross-package dependency for a purely cosmetic relocation. Leave until something else forces a `shared` dependency in `tokenizer`.
