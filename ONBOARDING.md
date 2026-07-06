# Handover — AI Studio

For whoever (human or agent) picks this up next. Read this before `PROJECT_STATUS.md` — that file predates most of what's below and understates/misstates current state in several places (safe to update or delete once this doc is trusted).

## What this project is

AI Studio is a model-agnostic "git for AI-native work" — context (not chat) is the primary object, branches/forks let you fork a conversation's context the way you'd fork code, and it accumulates memory/decisions/artifacts across a project instead of re-explaining yourself to a model every session. Electron + React (renderer) + Node (main process, TypeScript throughout). Started 2026-05-27, solo-built, currently pre-launch, validated against one 18-person startup pilot who confirmed the actual pain point (client → SPOC → design → dev, everyone's AI has different context) is real for them.

## Product sequencing — don't relitigate this

Decided and validated, not up for debate without a real reason:

1. **Ship the single-user "git for my own AI context" product first.** This is what's architecturally built today (local SQLite, no server, BYOK).
2. **Multi-user comes later as an async push/pull/merge model — explicitly NOT live real-time multiplayer.** The actual workflow described by the pilot customer (client sends docs → SPOC hands off → design → dev) is sequential handoff, not simultaneous editing, so it maps to git's async model, not Figma/Google-Docs-style live collab. `packages/prompt-engine`'s branch-diff logic (finds unique/conflicting decisions between branches) is already most of what "merge" would need — reuse it rather than building conflict resolution from scratch when this gets built.

## Backend — solid, recently hardened

Confirmed by direct code reading this session, not just taking README claims at face value: MCP client, LSP client, RAG/MMR retrieval, the local knowledge graph, hierarchical memory scoping, and the agent loop are all real, working implementations, not scaffolding.

**What changed this session (committed — see `git log`, commit `2e035fa`):**
- Added real tests for the four highest-risk, previously-untested files: `packages/ai-core/src/agent.ts` (the tool-call loop + hallucination guard), `packages/ai-core/src/classifier.ts` (the queue/retry pipeline), `packages/tools-runtime/src/mcp/client.ts`, and `packages/tools-runtime/src/lsp/client.ts`. The MCP/LSP tests spawn a real fake stdio server fixture (`__tests__/mcp/fixtures/`, `__tests__/lsp/fixtures/`) rather than mocking the client — they exercise real JSON-RPC framing.
- Removed dead Drizzle tooling (`drizzle-orm`/`drizzle-kit` deps, `db:generate`/`db:migrate` scripts in root + `packages/database` + `Makefile` + README) — it was never wired to anything; the actual DB layer is raw SQL over `better-sqlite3`.
- Renamed `packages/tools-runtime/src/acp/` → `agent-session/`, `ACPService` → `AgentSessionService`. It shared a name with the real Agent Client Protocol standard but isn't spec-compliant and was (and still is) unwired dead code. If someone wants real ACP interop later, that's a deliberate, scoped feature to build — don't just rename it back.

**Still genuinely untested** (lower severity than what got fixed, but real): `packages/ai-core/src/orchestrator.ts` (subagent delegation), `packages/tools-runtime/src/defaults.ts` (the actual registry/MCP-manager wiring the desktop app depends on), `packages/tools-runtime/src/mcp/auth.ts` (OAuth PKCE), `packages/tools-runtime/src/custom_loader.ts`. Worth covering before a live demo or onboarding a second user, not urgent otherwise.

**Electron vs. Tauri:** current ~400MB RAM baseline was checked and is close to Electron's structural floor (one `BrowserWindow`, lazy-loaded local ML models, no leaked DevTools — verified, not assumed). Not a bug. A future Tauri migration would only need to rewrite `apps/desktop`'s shell/IPC layer — `packages/*` backend stays as a Node sidecar. Not worth doing now; the near-term audience (developers) already runs several Electron apps daily.

## Frontend — design system + component library rebuilt (uncommitted); shell & pages are next

**Read `DESIGN.md` (repo root) before touching any UI.** It documents the implemented token system, all 31 components, the stack decisions, and two hard-won gotchas (the `pressable` transition rule and the tailwind-merge token registration) that will reintroduce fixed bugs if violated. This section is only the summary.

**Current state (2026-07-06, all working-tree changes — still uncommitted):**
- Old pages + shadcn/Radix component library deleted (previous session). Deletion rationale: composition genericness, not code quality.
- **New design system implemented in `globals.css`:** WARM MONO palette (black/white/gray warmed toward amber; this **superseded the earlier navy+ember direction** — the old "Ember accent" guidance below in git history is stale, do not resurrect it), elevation-ramp depth, Mona Sans Variable, Phosphor icons (`*Icon` names only), soft radius scale with a nesting rule, full motion system (easings/keyframes/`pressable`/`skeleton`/`stagger-children`), warm focus glow for the composer.
- **New component library in `components/ui/`** (31 components): hand-written visual primitives + **Base UI** (`@base-ui-components/react`) for behavioral components. **Radix was removed entirely (unmaintained) — don't reintroduce it.** cmdk (command bar), sonner (toasts), `@shadcn/react` (message-scroller primitive) round it out. Everything is demoed in `components/ui-gallery.tsx`, mounted in `App.tsx` with a theme toggle — run `yarn dev` and interact.
- The chat kit is ready: composer (pill, attachment menu, glow), message + hover action rows (copy/regenerate/fork/delete/edit/retry, timestamps, mono model names, tooltips), message scroller (streaming follow, prepend-without-jump, scroll-to-message), markers, collapsible tool-activity.

**What's preserved from before and wired up — reuse, don't recreate:** `hooks/use-ipc-data.ts` (the data layer), `components/auth-provider.tsx` / `workspace-provider.tsx` / `ui-prefs.tsx`, `auth-guard.tsx`, `hooks/use-theme.ts`, `lib/utils.ts` (`cn()` — now with extended tailwind-merge config, see DESIGN.md), `window.d.ts`.

**Deliberately not built yet:** popover, progress/meter, form-field wrapper, scroll-area (build when a page needs them); the markdown/code renderer (build alongside the chat page against real streamed output).

**Next phase, in order:** (1) commit the working tree as clean separate commits, (2) app shell — title bar, sidebar, routes, (3) chat page composed from the existing chat kit, (4) delete `ui-gallery.tsx` once real routes exist.

## Quick facts

- Package manager: Yarn 4 workspaces + Turborepo. `make help` for common commands.
- Native module gotcha: `better-sqlite3` gets rebuilt for Electron's ABI by the `postinstall` hook on every `yarn install`, which breaks plain-Node `vitest` runs until you rebuild it for Node again (`cd node_modules/better-sqlite3 && npm run install`). Hit this once this session — not a regression, just a recurring friction point of this setup.
- `rtk` (a CLI proxy in this environment) intercepts `find`/`grep` as shell functions and can return stale/garbled results, including for `command find`/`command grep`. If a `find`/`grep` result looks wrong, re-verify with an absolute path (`/usr/bin/grep`, `/bin/ls`) before trusting it.
