# AI Studio (Squirl) — Project Status Tracker

> Last updated: 2026-07-28
> Source of truth for detail: `context/ONBOARDING.md` (backend/session history), `DESIGN.md` (repo root, UI system + changelog), `context/debt.md` (deliberate deferrals), `context/plan.md` (in-flight feature tracker), `context/memory-graph-redesign.md` (living-memory design). This file is a map to those, not a replacement — when they disagree with this file, they win.

## Vision

Squirl (renamed from "AI Studio" 2026-07-14) is a model-agnostic organizational intelligence layer — like Git for AI-native work. Context is the primary object, not chat: branches/forks let you fork a conversation's context the way you'd fork code, and the product accumulates memory/decisions/artifacts across a project instead of re-explaining itself to a model every session. Electron + React (renderer) + Node (main), TypeScript throughout. Solo-built, pre-launch, validated against one 18-person startup pilot.

**Domain hierarchy: Organisation → Project → Space → Chat → Branch.** Spaces (added 2026-07-06) are functional areas within a project (Design / Development / Business — the pilot customer's handoff boundaries); each owns memories, artifacts, and chats. A chat is a container; users always work *on a branch*. Every chat is born with a "main" trunk branch (invariant).

**Product sequencing (decided, not up for relitigation):** ship the single-user "git for my own AI context" product first (local SQLite, no server, BYOK — what's built today); multi-user comes later as async push/pull/merge, explicitly not live real-time multiplayer.

---

## Architecture

```
@squirl/shared          → Type definitions, tool-call summary/detail helpers, subagent event reducer
@squirl/tokenizer       → Token counting + model context limits + capability predicates (vision/PDF input)
@squirl/event-bus       → Typed IPC contracts (100+ channels)
@squirl/database        → SQLite store — repositories split by domain (chats/branches/artifacts/memory/…)
@squirl/graph-engine     → SQLite-backed knowledge graph with local MiniLM-L6 embeddings
@squirl/providers       → Anthropic, OpenAI, Google, Bedrock, OpenRouter, Cloudflare, CodexOAuth + Router with retry/fallback
@squirl/context-engine  → RAG retrieval with MMR reranking, cross-branch knowledge sharing
@squirl/tools-runtime   → 50+ tools, MCP client (OAuth 2.1 + Streamable HTTP), LSP client, Skills system, local browser (Patchright)
@squirl/prompt-engine   → Tiered context builder + progressive summarization + branch diff + tool-trail memory
@squirl/ai-core         → Agent loop, classifier, cost tracker, artifact extractor, subagent runtime, Claude Agent SDK engine (gated)
@squirl/ui              → Shared React hooks
@squirl/desktop         → Electron app — full UI (app shell, chat, settings, artifacts, memories)
```

---

## Backend Status

### ✅ Complete and hardened

Multi-provider BYOK (Anthropic/OpenAI/Google/Bedrock/OpenRouter/Cloudflare/CodexOAuth) with retry/fallback routing, org-level key overrides, live Codex model catalogue. SQLite persistence (WAL, indexed, transactional) with the full Org→Project→Space→Chat→Branch hierarchy, soft-delete cascades, a single **hard**-delete path (project delete, typed-challenge gated). Knowledge graph with local embeddings, cross-branch RAG (MMR), tiered context builder with progressive summarization and a tool-call-trail memory (the model can recall its own past tool calls). Agent loop with self-correction, cooperative yielding, hard timeouts, and cascading-abort semantics (Stop actually kills in-flight parallel subagents; background `delegate` jobs are deliberately immune). 50+ tools, real MCP OAuth 2.1 client (PKCE, DCR, token fallback for GitHub/Slack/Figma), LSP client, a real Skills system (GitHub-installable SKILL.md packages, model- and slash-invoked), tool-approval gating on side-effecting calls, memory dedup-on-add, automations (agent-scheduled recurring turns via croner), an opt-in local browser (Patchright — logged-in/bot-walled pages, scroll/self-verification tooling), full file/image/PDF/xlsx attachment handling (native PDF blocks for Claude/Gemini, scanned-PDF acceptance, paste/drag-drop, dedup, orphan sweep), thinking-block streaming, and per-tool-call expandable detail (args/result, redaction for sensitive fields like `browser_fill` text).

See `context/ONBOARDING.md` for the full dated history of how each of these landed (each entry is a real session log with root causes and gotchas) — do not re-derive it here.

### 🟡 In progress / gated

| Item | Status | Notes |
|------|--------|-------|
| Living memory graph (typed `updates`/`extends`/`relates` edges, branch-aware `isLatest`, gated `derives`) | **Built, phases 1–4 & 6 landed** (2026-07-19/20) | `context/memory-graph-redesign.md`. Phase 5 (full branch-merge conflict resolution) and phase 7 (UI: supersession chains, restore, typed-edge graph view) remain — land with the multi-user merge feature. |
| Claude subscription engine (run turns on the user's local Claude Code login instead of an API key) | **Built and tested, OFF by default** | `context/debt.md`. Code is done; gated on Anthropic granting the "previously approved" exemption for consuming claude.ai login/rate limits in a distributed product. Do not enable in a shipped build or market it until that clears. |

### 🟡 Not blocking, could improve later

| Item | Priority | Notes |
|------|----------|-------|
| Lint doesn't run anywhere (no ESLint 9 flat configs wired) | Medium | `context/debt.md` — ~20 min fix, do before relying on CI lint. |
| OCR for scanned PDFs on non-Claude/Gemini models | Low | Escalation ladder agreed (page-rasterization → image blocks first); pickup trigger is a real user report. |
| Register Squirl's own OAuth apps for GitHub/Slack/Figma/Google MCP presets | Medium | Administrative, not code — do before external users; Google's CASA verification has a multi-week lead time, start that first. |
| Per-agent retry button for a failed/timed-out `delegate` job | Low | Parked with trigger: users actually hitting failed delegates. |
| Browser screenshots + login-handoff prompt | Low | Browser tools are string-result only today. |
| Proactive (event-driven, non-scheduled) triggers | Low | No webhook surface in a local-first app; would be a polling automation. |
| Memory decay/soft-archive beyond dedup | Low | Superseded in scope by the living-memory design's lifecycle model; build alongside phase 2 if it becomes real. |
| ANN index for graph queries | Low | Brute-force cosine fine to ~2-3K nodes. |
| Sync server | Later | Schema is sync-ready; comes after MVP. |

---

## Frontend Status

**Design system, 31-component library, app shell, settings, chat page, artifacts/memories pages, and the right-panel context inspector are built and committed.** Read `DESIGN.md` (repo root) before touching any UI — it has the token system, every component, three hard-won gotchas, and a dated changelog with the reasoning behind each decision. Summary only, below.

### ✅ Built

- **App shell** — topbar (drag region, fullscreen-aware traffic-light gap, breadcrumb), project rail (drag-reorder, context menu), sidebar (org switcher, spaces tree with per-level context menus, ⌘K), name/confirm dialogs (typed-challenge variant for hard deletes).
- **Chat page** (`/chats/:chatId/branches/:branchId`) — streaming (frame-batched), persistent + expandable tool activity, thinking blocks, markdown incl. tables, images render above the bubble with a lightbox, edit/retry/regenerate/branch-from-here/pin, inherited-ancestry transcript on forks, subagent detail drawer with live transcripts, tool-approval card, question-tool panel (composer-attached, keyboard-driven), slash-command skill autocomplete + transcript chips, auto-titling.
- **Right panel** (context inspector, branch pages) — donut context meter + tier breakdown, persona select, selectable artifacts (feed the prompt, fork-inherited), memories by scope, per-model usage/cost. Progressive disclosure (collapsed = one-glance mono summary).
- **Settings** (`/settings/*`) — General (theme, tool-call-detail toggle, tool-permission rules, local-browser toggle, memory-inference toggle), Providers (keys, per-provider model management, Codex account, Claude-subscription-engine toggle), MCP (quick-connect presets, OAuth/token auth, custom servers), Skills (install/enable/remove, GitHub discovery), Automations (list/toggle/delete), Organization (rename, hard-delete, API-key overrides, project moves), Project (rename, hard-delete with typed challenge, icon/description/system-prompt).
- **Artifacts page** (`/artifacts`, `/spaces/:spaceId/artifacts`) — format-native viewers in `components/viewers/`: pdf.js for PDFs, mammoth for docx, table/sheet viewers for csv/tsv/xlsx (editable where the text IS the file).
- **Memories page** (`/memories`, `/spaces/:spaceId/memories`).

### ❌ Still placeholders

- **Home** (`/`) — landing/dashboard.
- **Knowledge base** (`/knowledge-base`) and **Knowledge graph** (`/graph`) — visualization of the living memory graph (typed edges) is spec'd in `memory-graph-redesign.md` phase 7, not built.
- **Branch comparison** (`/branches/compare`) — backend diff logic already exists in `prompt-engine` (finds unique/conflicting decisions between branches); needs a UI.
- **Costs** (`/costs`) — project-level cost view; per-branch costs already ship in the right panel.
- **Bare chat route** (`/chats/:chatId`) — chats always resolve to a branch in practice; this route is effectively dead.
- `ui-gallery.tsx` (`/gallery`) is a dev scratchpad, not a shipping screen — delete once the above are covered.

### Known frontend gaps (see DESIGN.md/ONBOARDING.md for detail)

- Memories/artifacts aren't scoped to spaces in the data model yet (a space's "memories" count is really its chats' chat-/branch-scoped facts).
- Mid-stream chat resume after navigating away isn't live (final reply lands via refetch, no resumed streaming view).
- Composer attach menu is partially wired (files/skills real; some entries visual-only — check current state before assuming).
- Per-turn cost isn't surfaced in message actions (only in the right panel's aggregate).

---

## IPC Channels

100+ typed channels across org/project/space/chat/branch/message/artifact/memory/user/costs/models/config/skills/automation/mcp/window/system. See `@squirl/event-bus` for the authoritative typed contract list — it grew substantially past the org/project/chat/branch/message/artifact/memory/user/models/config/costs set and is no longer worth hand-duplicating here; grep `packages/event-bus/src` for the current channel names when wiring a new consumer.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Electron 33, Node 20+ |
| Language | TypeScript 5.7 |
| Build | Yarn 4 + Turborepo + Vite 6 |
| Frontend | React 19, hand-written primitives + Base UI (`@base-ui-components/react`) for behavioral components — **Radix removed, don't reintroduce**; cmdk (command bar), sonner (toasts), `@shadcn/react` (message scroller), pdf.js (PDF viewer), mammoth (docx), SheetJS (xlsx) |
| Database | SQLite (better-sqlite3), raw SQL — Drizzle removed as dead tooling (2026-07-05) |
| Embeddings | HuggingFace Transformers.js (local, no network); local NLI (`mobilebert-uncased-mnli`) for memory-relation detection |
| LLM Providers | Anthropic, OpenAI, Google, Bedrock, OpenRouter, Cloudflare, CodexOAuth; optional Claude Agent SDK engine (gated, off by default) |
| Automation | croner (cron scheduling) |
| Browser automation | Patchright (optional dep, opt-in local browser tool) |
| Packaging | Electron Forge (productName "Squirl") |

---

## Next Steps (recommended order)

1. **Placeholder pages by priority**: Home, Costs, Branch comparison (backend diff logic is ready — this is the cheapest win), Knowledge graph.
2. **Chat follow-ups**: mid-stream resume after navigating away, finish composer attach-menu wiring, per-turn cost in message actions.
3. **Living memory graph phase 5 + 7**: branch-merge conflict resolution (lands with push/pull), supersession-chain UI.
4. **MCP preset OAuth apps**: register Squirl's own GitHub/Slack/Figma/Google OAuth clients before onboarding external users (Google CASA review takes weeks — start first).
5. **Lint**: wire ESLint 9 flat configs (~20 min, currently silently not running).
6. **Claude subscription engine**: revisit once Anthropic's approval-gate status changes; do not enable/market before then.
7. **Delete `ui-gallery.tsx`** once its remaining components (Home-style layouts) are covered by real pages.
8. **Sync server** — when ready for team/multi-user features.
