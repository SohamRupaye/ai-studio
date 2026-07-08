# plan.md — Right panel: the context inspector

Plan of record for the collapsible right panel on branch pages (Soham's iPad sketch, 2026-07-08). Read `DESIGN.md` for the design system and `ONBOARDING.md` for project state before implementing anything here. Check tasks off as they land and note deviations inline — this file is the map, the changelogs in DESIGN/ONBOARDING stay the history.

## What it is

A collapsible right panel, branch pages only, that answers one question: **what will the model see next turn, and what did that cost.** It is the product thesis (context as the primary object) made visible and steerable — not four unrelated widgets.

Sections, top to bottom:

1. **Context** — the assembled result. Context-window fill meter (tokens vs. model limit) + breakdown by tier (ancestry / summaries / retrieved / hot window), from the tier data `buildPayload` already returns.
2. **Artifacts** — an input you control. Phase 1: read-only list of this branch's artifacts. Phase 2: checkbox per artifact = include it in this branch's prompt (the killer interaction: tick a doc, watch the meter move).
3. **Memories** — an input you observe. Read-only viewer of the facts feeding this branch's prompt, grouped by scope exactly as the prompt sees them (global / project / chat / branch), with remove. Deliberately NOT checkboxes: memories auto-feed by scope, and per-branch muting would create a second source of truth. Revisit only with a real use case.
4. **Usage** — the receipt. Per-turn cost rows + branch total from `costs:branch` (exists, currently unread by any UI).

## Design constraints (from DESIGN.md — don't relitigate)

- The panel is **chrome**: it sits on bare canvas like the left sidebar; the page card stays the one raised hero. No colored chips; color only for state.
- Mono font for the data (token counts, costs, model names) — never for section labels or prose.
- Collapse mirrors the left sidebar: width-animated wrapper, fixed inner width so text doesn't reflow. `UiPrefsProvider.rightPanelOpen` already exists and persists — use it, don't add a second pref.
- Toggle button lives at the topbar's right end, next to the model switcher (both are branch-page-only controls).
- Default open on branch pages (the panel is the pitch); the persisted pref takes over after the user touches it.

## Phase 1 — shell + honest data (no new prompt behavior)

Everything here reads state that already exists or is captured as a side effect of `chat:send`. Nothing changes what the model receives.

- [x] **`ui/meter.tsx`** — the context-fill meter (track + fill on the elevation ramp, value rendered in mono). This was on the "deliberately not built until a page demands it" list; this page demands it. Remove it from that list in DESIGN.md when built.
- [x] **Context stats capture (main)** — `chat:send` already builds `ContextPayload` with `tierAncestry/tierWarm/tierRetrieved/tierHot/tokenEstimate`; stash it per branch after each turn (persist as store meta `ctxstats:<branchId>` so it survives restart) together with `contextLimit(model)`, model, and timestamp. New IPC `context:stats { branchId }` returns it, or `null` for a branch that hasn't run a turn yet. **Deliberately NOT a live dry-run of `buildPayload`**: ancestry compression can call the model and retrieval runs embeddings — an inspector must never spend tokens. The panel shows "as of the last turn" and says so.
- [x] **`memory:for-branch` IPC** — `GlobalMemory.forBranch(branchId, chatId, projectId)` already resolves the exact fact set prompt assembly uses; expose it (facts with scopes, renderer groups them). Reuse existing `memory:remove` for deletion.
- [x] **Branch artifacts IPC** — `artifact:list` is project-scoped; add `artifact:for-branch` (artifacts with this `branch_id`, live only). Read-only list in the panel; each row opens the artifact (route exists at `/artifacts` level — link is fine for phase 1).
- [x] **`right-panel.tsx`** — the panel itself: canvas chrome, `w-[280px]` inner fixed width, width-animated wrapper in `AppShell` after `<main>`, rendered only when the route matches `/chats/:chatId/branches/:branchId` (same `matchPath` the topbar uses). Sections as `Collapsible`s with sticky-feel headers; section state local (not persisted) for now.
- [x] **Topbar toggle** — icon button (sidebar-right Phosphor icon) at the right end next to the model switcher, branch pages only, wired to `toggleRightPanel`.
- [x] **Refetch on turn completion** — the panel's queries must refresh when a turn finishes. The chat page already calls `invalidateQueries()` on `done`; panel queries ride the same registry for free. Verify, don't rebuild.
- [x] **Empty states** — honest copy per section: Context "Send a message to see what the model used", Artifacts "Nothing extracted on this branch yet", Memories "No memories feed this branch yet", Usage "No turns yet". IPC failure → the established error + retry pattern, never a fake empty state.
- [x] **Personalized empty-state greeting (chat page)** — from the sketch: "Good morning, Soham — what shall we build today?" over the centered composer (user name from `user:get`, time-of-day aware, plain sans, no new hero). Small, but it fixes the same "wide and empty" complaint on fresh branches.
- [x] **Docs** — DESIGN.md changelog entry (+ meter off the not-built list), ONBOARDING frontend state, this file's checkboxes.

**Verify phase 1 by**: sending a turn on a real branch → meter and tiers populate and match the payload; deleting a memory from the panel → next turn's `<global_memory>` block no longer contains it; costs rows match the Costs the DB has; collapse state survives app restart; non-branch routes never show the panel.

**v1.2 (shipped)**: progressive disclosure — collapsed section headers carry one-glance mono summaries (0% / Default / counts / total cost), all sections start collapsed except Context, per-section expand state persists in localStorage. The overload complaint was sections all speaking at once, not the data itself.

**v1.1 (same-day feedback, shipped)**: Context simplified to a donut ring (`MeterRing`) + one tokens line with only non-zero tier rows; hairline separators + one spacing grammar across sections; Usage regrouped per model (turns × cost); Memories loosened; **Persona section added** (branch-scoped select over the existing `persona:*` IPC). Personas were not in the original plan — panel section order is now Context / Persona / Artifacts / Memories / Usage.

## Phase 2 — artifact selection with teeth (changes what the model sees)

The checkbox column from the sketch: per-branch artifact selection that feeds prompt assembly.

- [x] **DB: selection on the branch row** — `selected_artifacts` JSON column on `branches` (array of artifact ids), mirroring how `pins` already lives there. Migrated column → no index in SCHEMA block (the migration gotcha). Store methods: `getSelectedArtifacts` / `setSelectedArtifacts`.
- [x] **Fork inheritance** — `createBranch` copies the parent's selection (a fork inherits its parent's context — that IS the git-for-context story). Test it.
- [x] **Prompt assembly** — `buildPayload` gains a `<selected_artifacts>` block (title + content per selected artifact, one-line semantics intro like the other blocks). Token-budget drop order: selected artifacts are *explicit user intent*, so under pressure they drop LAST — after `<conversation_summaries>` and `<ancestry>`, never before. Oversized single artifacts get truncated with a visible `[truncated]` marker rather than silently dropped.
- [x] **IPC** — `branch:artifacts-set { branchId, artifactIds }` (whole-array set; simpler than add/remove pairs and the UI always knows the full selection).
- [x] **Panel checkboxes** — Artifacts section becomes selectable (existing `Checkbox` component); selection scope is ALL project artifacts (grouped: this branch's / other), since the point is pulling a doc from elsewhere into this branch's context.
- [x] **Live meter estimate** — ticking a checkbox immediately adjusts the Context meter by `estimateTokens(artifact.content)` (cheap IPC returning per-artifact token counts, or counts included in the artifact list payload). Estimate rendered as "≈" against the last-turn baseline — honest about being a projection until the next turn.
- [x] **Tests** — store (selection CRUD + fork inheritance + migration), prompt-engine (block presence, drop order, truncation marker).
- [x] **Docs** — changelog entries; update the known-gaps list in ONBOARDING (this closes part of the "artifacts aren't wired to anything" gap; the space-scoping data-model gap remains separate).

**Verify phase 2 by**: selecting an artifact → next turn's request payload contains its content (log it in dev); forking the branch → child shows the same selection; deselecting → block disappears; a huge artifact truncates with the marker instead of blowing the budget.

## Explicitly out of scope (both phases)

- Per-memory checkboxes / muting (see Memories rationale above).
- Space-scoping memories/artifacts in the data model — separate discussion, tracked in ONBOARDING known gaps.
- Panel on non-branch pages (Home, settings, etc.) — it is a branch instrument.
- Artifact editing inside the panel — the panel inspects and selects; editing stays on artifact pages.
