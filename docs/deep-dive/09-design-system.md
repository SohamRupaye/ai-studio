# 09 — Frontend & Design System

> How the UI is built and why it looks the way it does. Source of truth in the repo: `context/DESIGN.md` (58 KB). This is the condensed summary.

## The stack (renderer)

- **React 19** in the Electron renderer, **BrowserRouter** for routing (`index.tsx` → `App.tsx`).
- **Tailwind v4** with a full custom token system in `globals.css` (CSS variables mapped into Tailwind via `@theme inline`).
- **Base UI (`@base-ui-components/react`)** for *behavioral* components (menus, dialogs, tabs, switches). **Not Radix** — Radix is unmaintained and was removed entirely. Don't reintroduce it.
- Hand-written **visual primitives** (buttons, cards, badges, inputs) — 31 components total, barrel-exported from `components/ui/index.ts`, demoed at the `/gallery` route.
- Supporting libs: **cmdk** (command bar), **sonner** (toasts), **Phosphor icons** (must use the `*Icon`-suffixed names), `@shadcn/react` (only for the message-scroller primitive).
- Font: **Mona Sans Variable** (bundled, no network).

## The design philosophy (this is a good "tell me about a design decision" answer)

The user (Soham) rejected two earlier UIs for looking **"AI-generated"**: flat neutral gray, evenly-weighted panels, colored icon chips, generic admin dashboards. Reference points he liked: **Dia, Arc, Wise, Notion, Sana.**

The rules that came out of that, which survive any redesign:

1. **One hero moment per screen.** On the chat page it's the composer; everywhere else it's a single primary button. Nothing competes with it.
2. **Depth comes from an elevation ramp, never decoration.** There's a four-step ramp — `canvas → surface-1 → surface-2 → surface-3` — and the rule is simply **"raised = lighter."** Layout is *done with elevation*: the chrome (topbar, sidebar, rail) sits on bare canvas, and the page itself is a raised card floating on top.
3. **Monospace font only for data, never prose** — model names, token counts, costs, branch names, numbers. This makes "machine data" visually distinct from human text. (Exception the user demanded: navigation rows stay uniform sans, because mono branch names in the sidebar read as inconsistency, not information.)
4. **Color means state, not category.** No colored icon chips. A red thing is red because something is *wrong*, not because it's "the delete category."
5. **Everything animates** — entrance + press micro-animations on every interactive element, with a disciplined motion system (things *arrive* decelerating, *leave* accelerating, respond to touch with spring). `prefers-reduced-motion` globally collapses it all.
6. **Warm mono palette.** Black/white/gray only, but every gray is warmed ~4% toward amber — "candlelit, not clinical." This *superseded* an earlier navy+ember direction after a literal side-by-side comparison (`design-comparison.html` in the repo root). If someone mentions "the ember accent," that's stale.

The meta-point worth saying out loud: **the design system is treated as a living system with a changelog, not a fixed spec.** Every token or component change gets a dated "what changed and why" entry, so the reasoning is inherited, not just the diff.

## App shell anatomy

- **Topbar** — full-width drag region (it's a frameless window). Holds the breadcrumb (project / space / chat / branch), the model switcher, and the right-panel toggle. It's *fullscreen-aware*: it drops the 76px macOS traffic-light gap when fullscreen (driven by a `window:fullscreen-changed` push event from the main process).
- **Project rail** — 64px column of project tiles (neutral initials; active = raised).
- **Sidebar** — 256px. Project name as the headline, org as an eyebrow menu above it. A spaces tree: `space ▸ Memories / Artifacts / Chats ▸ chat ▸ branch`. Branch rows own the management context menu (Rename / Fork / Export→Markdown / Delete). Collapse state persists.
- **Right panel** ("the context inspector") — see below.

## The chat page (the built centerpiece)

`chat-page.tsx` at route `/chats/:chatId/branches/:branchId`. This is where the real engineering in the frontend is:

- **Streaming** — assistant text streams token-by-token over an SSE-style `chat:stream` IPC event. Every event carries a `branchId` so streams on different branches don't cross-contaminate.
- **Persistent tool activity** — collapsible "Explored 4 files" rows that show *what* each tool call did (the args preview), live during streaming and re-hydrated from storage afterward.
- **Message actions** — edit, retry, regenerate, copy, pin, **branch-from-here** (fork the conversation at that message), delete.
- **Markdown** — a dependency-free markdown renderer (`ui/markdown.tsx`) including tables.
- **Images** render *above* the user bubble (not inside it, which stretched the bubble); clicking a thumbnail opens a fullscreen lightbox.
- **Subagent transcripts** — when the model delegates to subagents, a non-modal drawer shows each subagent's full live transcript (text + tool calls), not just "Working…".

### Two hard-won gotchas on the chat page (great "debugging story" material)

1. **Shared-regex OOM.** A markdown regex with the global flag was shared across calls; `lastIndex` state leaked between invocations and eventually blew up memory. Fixed by not sharing stateful regexes.
2. **Frame-batched streaming.** Naively applying every streamed token as a React state update thrashed the renderer (now streaming per-token *times* up to 4 concurrent subagents). Text deltas are batched onto a single `requestAnimationFrame` frame, and main + renderer fold subagent events with the *same reducer* so the live view and the persisted record are guaranteed identical.

## The right panel — context made visible

This is the UI expression of the whole product thesis (context is the object), so it's worth describing: on any branch page there's a collapsible inspector showing, for the current turn:

- **Context** — a donut meter of the token budget with a per-tier breakdown (system / memories / retrieved / artifacts / history). It re-projects "≈ N tokens with current selection" live when you change what's attached.
- **Persona** — a branch-scoped persona selector.
- **Artifacts** — every project document with a checkbox = "attach this to this branch's prompt," grouped into "This branch" / "Elsewhere," with a per-document token estimate.
- **Memories** — the facts that will be injected, grouped by scope, each removable.
- **Usage** — cost per model for this branch.

The point: the user can *see and control* exactly what the AI is being told. That's the anti-black-box stance the whole product takes.

## Three component-system gotchas (if asked about the design system specifically)

1. **`pressable` owns the entire interaction transition.** Never stack a `transition-*` utility on it — the CSS shorthand conflict silently kills one animation.
2. **tailwind-merge is extended** in `lib/utils.ts` to teach it that our custom `text-*` tokens are font *sizes* (not colors) — without that it silently dropped button label colors (invisible-label bug).
3. **Base UI `MenuLabel` must sit inside a `MenuGroup`** or it throws when the popup mounts — which presents as a blank screen on right-click, not a render-time error.

These three exist in the doc specifically because violating them *reintroduces already-fixed bugs* — a nice example of encoding institutional memory into the docs.
