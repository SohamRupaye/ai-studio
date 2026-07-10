# debt.md — deliberate deferrals

Known gaps we chose not to build yet, each with the context to decide later and a concrete trigger for picking it up. Add entries when work is consciously parked; delete them when done or obsolete. This file is the "later" list — `plan.md` is the "now" list.

## Scanned-PDF coverage beyond Claude/Gemini (OCR) — parked 2026-07-10

**Current state:** scanned (image-only) PDFs are accepted at upload (blob preserved, placeholder text, caveat toast). On models with native PDF input (Claude, Gemini — gated by `supportsPdfInput()` in `packages/tokenizer`) they ride as document blocks and the provider OCRs server-side, so they just work. On every other model the context carries an honest `[Scanned PDF — no extractable text layer…]` placeholder.

**Who's in the gap:** users on a non-Claude/Gemini model attaching scanned PDFs. Most of those models still have vision, just not PDF input.

**Agreed escalation ladder (build in this order, only as far as demand requires):**
1. **Page rasterization → image blocks** for vision models without PDF support (GPT-4o/4.1, o-series, Pixtral, Qwen-VL…). No OCR dependency; a vision model reading page images beats tesseract on messy scans. The bulk of the work is a pdf.js page renderer in a hidden BrowserWindow (main process has no canvas) — and that renderer is the shared prerequisite for every later step. Also improves layout-heavy *regular* PDFs on those models.
2. **True OCR for text-only models**, only if that intersection materialises. Options weighed: macOS Vision framework bindings (fast, high quality, per-OS native code) vs tesseract.js (cross-platform WASM, ~10–15MB lang data, 1–5s/page, mediocre on real scans) vs one-time vision-model transcription stored into the artifact content (paid once, reuses the provider layer). Note: OCR at upload time breaks the synchronous upload flow — needs background jobs + progress UI + cancellation.

**Pickup trigger:** a user on a non-Claude/Gemini model actually reports a scanned PDF they need read. Until then, the honest placeholder is doing its job.

## Lint is not running anywhere — pre-existing, surfaced 2026-07-09

`yarn lint` cannot pass: workspaces have `lint: "eslint src/"` scripts but no `eslint` devDependency and there are **no `eslint.config.*` files in the repo** (ESLint 9 needs flat configs; `tooling/eslint` exports one nothing consumes). The occasional turbo "pass" is a stale cache replay. Fix is ~20 minutes: add `eslint` + `@ai-studio/eslint-config` as devDeps where the script exists, add per-workspace `eslint.config.js` importing the tooling config.

**Pickup trigger:** before relying on CI lint as a gate, or the next "chore: lint" pass.

## Capability predicates live in the tokenizer package — cosmetic

`supportsVision()` / `supportsPdfInput()` are model-capability metadata, not tokenization, but moving them to `@ai-studio/shared` would add a new cross-package dependency for a purely cosmetic relocation. Leave until something else forces a `shared` dependency in `tokenizer`.
