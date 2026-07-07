# DESIGN.md — AI Studio design system & component library

Context doc for whoever (human or agent) builds UI next. Everything described here is **implemented and working** in `apps/desktop/src/renderer/` — this is not a proposal. Read this instead of re-deriving the design system; read `ONBOARDING.md` for project-wide context.

State as of 2026-07-06 (second session): tokens + 31-component library complete and demoed in a dev gallery (`components/ui-gallery.tsx`, now at the `/gallery` route). **The app shell is built and user-approved**: fixed topbar (hamburger + breadcrumb), project rail, sidebar with the spaces tree, routing. All destination pages are placeholders — the chat page is the next phase. Working tree is uncommitted; check `git status`.

**This is a living system, not a spec.** Improve it when a real use case demands it — several of today's best decisions (raised selects, the `*-text` badge tones, the glow) came from exactly that kind of revision. The distinction that matters: *evolve with a reason* (a page needs something the system doesn't do well) vs. *relitigate settled taste* (the warm-mono palette, the one-hero rule, mono-for-data — those stay unless the user reopens them). When you change tokens or component behavior, add a dated entry to the **Changelog** at the bottom of this file saying what changed and why, so the next iteration inherits the reasoning and not just the diff.

## Design direction (settled — don't relitigate)

The user (Soham) rejected two earlier UIs for looking "AI-generated": flat neutral gray, evenly-weighted panels, colored icon chips, generic admin layouts. Reference points: Dia, Arc, Wise, Notion, Sana.

**Rules that survive any redesign:**
- One hero moment per screen (the composer on chat; one primary button anywhere else).
- Depth comes from the **elevation ramp**, never decoration. Raised = lighter.
- Mono font **only for data in content**: model names, tokens, costs, branch names, numbers. Never prose. **Navigation rows are uniform sans regardless** — the user overruled mono branch names in the sidebar tree (read as inconsistency, not information); a small icon carries the row's identity instead.
- No colored icon chips. Color must mean state, not category.
- Sentence case everywhere.
- Every interactive element gets entrance/press micro-animation.
- **Palette is WARM MONO.** This superseded an earlier navy+ember direction after a side-by-side (`design-comparison.html` in repo root). Do not resurrect ember/navy without the user asking — older docs mentioning an Ember accent are stale.

## Tokens (`globals.css`)

All tokens are CSS variables set on `:root` (light, default) and `.dark`, mapped into Tailwind v4 via `@theme inline`. Theme switching = `.dark` class on `<html>` (`hooks/use-theme.ts`, system-follow default).

### Color — warm mono

Black/white/gray only, every gray warmed ~4% toward amber ("candlelit, not clinical").

- **Elevation ramp:** `canvas` (page, dark `#121110` / light `#F6F5F2`) → `surface-1` → `surface-2` → `surface-3`. Raised = lighter. `sunken` exists but is used **only** for the switch track (see field history below).
- **Text:** `fg` (dark mode `#DCDAD6` — deliberately not white), `fg-muted`, `fg-subtle`.
- **Lines:** `line`, `line-strong` (hover/focus border step).
- **Primary** (the hero action): soft warm gray — dark `#CBC8C1`, light `#33302A` — with `primary-fg`, `primary-hover`, `primary-active`. Never pure white/black.
- **Status triads:** `info|success|warning|danger` each have: solid (`--danger`), soft tint (`--danger-soft`), and **`--danger-text`** — a text-on-tint tone (darker than solid in light mode, brighter in dark). Badges use soft + text; buttons/alerts use solid/soft. Light-mode danger is a soft vermilion `#DD4938`, not harsh red.
- **Viz palette:** `viz-1`…`viz-8` for charts.

### Shadows

`shadow-xs/sm/md/lg/xl` ramp, plus semantic: `shadow-raised` (subtle lift; includes 1px inset top-light in dark), `shadow-sunken` (inset), `shadow-float` (floating hero elements, e.g. composer), `shadow-glow` (**focus glow for the hero composer** — warm emitted light in dark mode, halo-ring + deepened ambient in light mode; never blue).

### Radius — soft scale

`xs 4 / sm 8 / md 10 / lg 16 / xl 20`. Controls → `rounded-md`; cards/panels → `rounded-lg`; modals/drawers/floating popups → `rounded-xl`; composer & chips → pills. **Nesting rule: inner radius = outer radius − padding** (e.g. menu popup 16px − 6px padding = 10px items; tabs list 10px − 4px = 6px indicator).

### Typography

Mona Sans Variable (`@fontsource-variable/mona-sans/wdth.css`, bundled). Body is 14px with −0.006em tracking.

Tailwind text utilities (registered in `@theme`): `text-heading-lg/md/sm` (26/22/18, weight **600** — 700 is reserved for the one hero moment), `text-body-lg/md/sm` (16/14/12 at 400), `text-label-lg/md/sm` (14/13/11 at 500 — buttons, tabs, menu items, badges, table headers).

### Motion

- Easings: `--ease-standard`, `--ease-decel` (arrivals), `--ease-accel` (exits), `--ease-spring` (touch response). Rule: things ARRIVE decelerating, LEAVE accelerating, respond to touch with spring.
- Durations by convention: 50 press · 100 hover · 200 most · 300 entrances · 500 emphasis.
- Keyframes: `rise`, `pop`, `typing`, `fade-in/out`, `slide-in/out-right|left|bottom` (slide distances include the drawer's floating inset).
- Utilities: `pressable` (see gotcha below), `skeleton` (opacity pulse, no shimmer), `stagger-children` (list entrances, 30ms apart).
- `prefers-reduced-motion` globally collapses all animation.
- Focus: keyboard-only ring (`:focus-visible`, mono low-alpha). Disabled: universal fade via `:disabled`/`aria-disabled`.

## Three hard-won gotchas (violating these WILL reintroduce fixed bugs)

1. **`pressable` owns the entire interaction transition** (transform + colors + shadow + opacity). Never stack a `transition-*` utility on a pressable element — the CSS shorthand conflict silently kills one of the animations. If an element needs press feedback + color transitions, `pressable` alone already does both.
2. **tailwind-merge is extended in `lib/utils.ts`** to know our custom `text-*` tokens are font *sizes* and `shadow-raised/sunken/float/glow` are shadows. Without that registration it classified `text-label-md` as a *color* and silently dropped `text-primary-fg`/`text-white` from buttons (invisible-label bug). If you add new custom `text-*` or `shadow-*` theme tokens, **register them there too**.
3. **`MenuLabel`/`ContextMenuLabel` must sit inside a `MenuGroup`/`ContextMenuGroup`.** They're Base UI `GroupLabel` parts, which throw ("Menu group parts must be used within <Menu.Group>") when the popup mounts — and since popups mount on open, the crash presents as a blank screen on right-click, not at render time.

## Stack decisions

- **Base UI (`@base-ui-components/react`), NOT Radix.** Radix is unmaintained; all `@radix-ui/*` deps were removed — don't reintroduce them. Base UI conventions: parts are `Root/Trigger/Portal/Positioner/Popup`; custom element injection is the **`render` prop** (not `asChild`); state attrs are `data-checked`, `data-popup-open`, `data-highlighted`, and — careful — tabs use **`data-active`**, not `data-selected`. Animations: keyframes on `data-[open]`/`data-[closed]`, or transitions with `data-[starting-style]`/`data-[ending-style]`.
- **`@shadcn/react`** (shadcn's new headless primitives pkg) provides the message-scroller. It currently ships only that.
- **cmdk** powers the command bar (inside a Base UI dialog); **sonner** powers toasts (restyled `unstyled`).
- **Phosphor icons** — imports MUST use the `*Icon`-suffixed names (`CopyIcon`, not `Copy`; bare names are deprecated). Selected-state pattern: `weight={selected ? "fill" : "regular"}`.
- Button `asChild` uses a local ~10-line Slot in `button.tsx` (React 19 ref-as-prop).

## Component library (`components/ui/`, barrel-exported from `index.ts`)

Hand-written visual primitives + Base UI-backed behavioral components. Everything below is demoed in `ui-gallery.tsx` — read it for canonical usage of each.

| Component | File | Notes |
|---|---|---|
| Button | `button.tsx` | Variants: `primary` (hero, one/screen), `secondary` (default), `outline`, `ghost`, `danger`. Sizes sm/md/lg + icon-sm/icon/icon-lg. `asChild`. |
| ButtonGroup | `button-group.tsx` | Joined segments, collapsed borders. Plain mode (Buttons) for action clusters; pass `value`/`onValueChange` (+ `ButtonGroupItem value=…` children) for a single-select segmented control — Base UI ToggleGroup underneath, selected segment walks the elevation ramp (surface-1 → hover surface-2 → pressed surface-3 + raised). |
| Badge | `badge.tsx` | Pill, `px-3.5 py-2` (user-tuned), status variants use soft bg + `*-text` tone. |
| Card | `card.tsx` | + Header/Title/Description/Content/Footer; `interactive` prop = hover-elevate + pressable. |
| Input / Textarea | `input.tsx` | Fields rest at `surface-1`, focus lifts to `surface-2` + `line-strong`. **History: two rejected attempts** — bg-canvas (invisible) and bg-sunken ("black pit" in dark). Don't re-sink fields. Exports `fieldSurface`. |
| Select | `select.tsx` | Trigger = raised control (`surface-2`, `shadow-raised`, 13px label — "the popup's closed form"), single chevron rotates on open. Pass `items` to Root so Value renders labels. |
| Combobox | `combobox.tsx` | Select-with-search (Base UI Combobox), string-valued API: `items/value/onValueChange`. |
| Menu | `menu.tsx` | Click dropdown. Exports shared `popupClasses`/`itemClasses` used by context-menu & select. Spring pop-in. |
| ContextMenu | `context-menu.tsx` | Right-click; same styling via shared classes. Checkbox/radio items, submenus, shortcuts. |
| Dialog | `dialog.tsx` | Centered modal (confirmations). Header/Body/Footer, `showClose`. |
| Drawer | `drawer.tsx` | Floating card inset from window edge (not edge-glued), sides right/left/bottom. |
| Tooltip | `tooltip.tsx` | In-theme raised chip (`surface-3` + border; inverted style was rejected as "broken theming"). `TooltipProvider` for instant-on-sweep clusters. |
| Tabs | `tabs.tsx` | Segmented; **sliding raised indicator** positioned by `--active-tab-*` vars. Remember `data-active`. |
| Switch | `switch.tsx` | Sunken track fills primary; thumb springs. |
| Checkbox | `checkbox.tsx` | Check pops in with spring (`keepMounted` indicator); `indeterminate` supported. |
| RadioGroup / Radio | `radio-group.tsx` | Dot pops with spring. |
| Slider | `slider.tsx` | For temperature/top-p. `showValue` renders mono number. Thumb grows on hover/drag; track deliberately not eased. |
| Separator | `separator.tsx` | Both orientations. |
| Skeleton | `skeleton.tsx` | Uses `skeleton` utility. |
| Spinner | `spinner.tsx` | Ring, `currentColor`, sm/md/lg. |
| Alert | `alert.tsx` | Status variants, auto Phosphor icon (override/`icon={null}`). |
| Toaster / toast | `sonner.tsx` | Mount `<Toaster theme={applied}/>` app-level (already in App.tsx); fire `toast()`, `toast.success()` etc. |
| Command bar | `command.tsx` | `CommandDialog` (⌘K pattern in gallery) + Input/List/Group/Item/Shortcut. |
| Kbd / KbdGroup | `kbd.tsx` | Keycaps; sans, not mono. |
| Highlighter | `highlighter.tsx` | Inline `<mark>` text highlight (amber default). Renamed from "marker" by the user. |
| Marker | `marker.tsx` | Chat-timeline event row (icon + text; `rule` prop = hairline divider style, "Conversation compacted"). |
| Composer | `composer.tsx` | The chat hero: floating pill, auto-grows to ~7 lines, Enter sends (IME-safe)/Shift+Enter breaks, `leading`/`actions` slots, circular primary send. Focus = `shadow-glow` bloom. `ComposerButton` for slot icons (holds hover tone while its menu is open). Gallery shows the attachment menu (files ⌘U / skills / artifacts / memories). |
| Message kit | `message.tsx` | `Message role=…` (user = bubble right, assistant = document text), hover/focus-revealed `MessageActions` with tooltipped `MessageAction`s, `MessageTimestamp`, `MessageModel` (mono). Assistant row: copy/regenerate/fork/delete + time + model. User row: edit/copy/retry + time. Handlers are props — wire real ones on the chat page. |
| MessageScroller | `message-scroller.tsx` | Chat scroll container (wraps `@shadcn/react/message-scroller`): `autoScroll` follows streaming, `preserveScrollOnPrepend` for history, `scrollAnchor` items, `useMessageScroller().scrollToMessage(id)`, floating jump-to-latest pill. Structure: Provider → Root → Viewport → Content → Item(messageId). |
| Avatar | `avatar.tsx` | sm/md/lg, image + initials fallback. |
| Collapsible | `collapsible.tsx` | For thinking blocks / tool activity ("Explored 4 files"): caret rotates, panel animates to measured height. |

## App shell (`components/`, not `ui/` — app composition, built 2026-07-06)

Elevation does the layout: **chrome (topbar, rail, sidebar) sits on bare `canvas`; the page is a raised `surface-1` card** (`rounded-lg border-line shadow-raised`, inset with margin). Widths: rail 64px + sidebar 256px = 320px chrome column; the collapse animation shrinks a fixed-width wrapper so text never reflows.

| Piece | File | Notes |
|---|---|---|
| AppShell | `app-shell.tsx` | Layout + ⌘K command bar (shares `PRIMARY_NAV`/`FOOTER_NAV` with the sidebar so they can't drift). |
| Topbar | `topbar.tsx` | Full-width drag region. Left zone's width mirrors the chrome column so the breadcrumb starts over the page card (Notion behavior); collapse slides it left. Fullscreen (via `window:fullscreen-changed` push + `window:is-fullscreen`) drops the 76px traffic-light gap. Breadcrumb = project / space / chat / branch (branch in mono — it's content-adjacent data in the topbar, not a nav row). |
| ProjectRail | `project-rail.tsx` | 40px neutral initial tiles (color = state, never category), active = raised; dashed + opens NameDialog. |
| Sidebar | `sidebar.tsx` | Header = **project name big, org as eyebrow menu** (rail item ↔ header must read as the same object — a Wheat-field-style pairing the user picked over org-led headers). Raised search (select-trigger language) → ⌘K. Nav: Home, Knowledge graph. Spaces tree: space ▸ Memories / Artifacts / Chats ▸ chat (pure accordion — you always land on a *branch*) ▸ branch rows. Hairline connector (`border-l`) carries nesting. Branch rows own the management context menu (Rename / Fork / Export→Markdown / Delete) headed by a "chat / branch" label; while a row's menu is open it holds its hover state via `group-data-[popup-open]`. |
| NameDialog / ConfirmDialog | `name-dialog.tsx`, `confirm-dialog.tsx` | Shared name-prompt (supports `initialValue` for renames; stays open on error — caller toasts) and danger-confirm modals. |

Sidebar collapse persists via `UiPrefsProvider` (`sidebarOpen`), same pattern as the right panel.

## Deliberately NOT built yet (build when a page demands it, not before)

- **Popover** (generic anchored panel), **progress/meter** (context-window %), **form field wrapper** (label+error glue for react-hook-form), **scroll-area** (native scrollbars fine for now).

## Next phase

1. Commit the working tree as clean separate commits.
2. Remaining placeholder pages (Home, per-space Memories/Artifacts, Knowledge graph, Compare, Costs, project Artifacts/Memories) as they earn priority.
3. Chat follow-ups when they hurt: mid-stream resume after navigating away (needs an "in-flight state for branch X" IPC), wiring the composer attach menu (currently visual-only), per-turn cost in message actions, chat auto-titling.
4. Delete `ui-gallery.tsx` (`/gallery`) once real pages cover its components (it's a dev scratchpad, not a shipping screen).

## Changelog

Dated entries, newest first: what changed and **why**. Add one whenever tokens or component behavior change.

### 2026-07-07 (later still) — The chat page ships; markdown renderer built against real streams

- **Chat page is real** (`components/chat-page.tsx`, the `/chats/:chatId/branches/:branchId` route; `App.tsx` keys it by branchId so switching branches resets draft/stream state). Empty state = centered composer (the one hero); active thread = `MessageScroller` (`autoScroll` — the primitive defaults it off) at `max-w-2xl` with the composer pinned below as a plain flex footer. The user's own message renders **optimistically** (`chat:send` doesn't resolve until the whole turn finishes — waiting on the refetch left it invisible for the entire generation), deduped once the persisted row lands.
- **Streaming is frame-batched**: token deltas arrive as individual IPC tasks (hundreds/sec, each previously its own render); they buffer in a ref and flush once per `requestAnimationFrame`. `Markdown` is `React.memo`'d — without it every delta re-ran inline parsing for every historical message (O(history × tokens), visible stutter). The live bubble overrides the scroller item's `content-visibility:auto` (`[content-visibility:visible]`) — Chromium can defer painting rapid in-place updates under it, which read as "whole reply pops in at once".
- **`chat:stream` events carry `branchId`** (event-bus type + every `send` in main): main runs one turn per window, so without the tag a turn left running for another branch rendered onto whatever page was open. The page filters on it; `done` triggers an unconditional refetch so a reply that finished while you were elsewhere still lands.
- **Markdown renderer** (`ui/markdown.tsx`): dependency-free line-based parser (paragraphs, headings, ul/ol, quotes, fenced code with copy + lang chip, **tables** — header + `|---|` separator, `overflow-x-auto` container, surface-2 header row) + inline code/bold/italic/links. Tolerates an unterminated trailing fence mid-stream. **Gotcha fixed (real OOM, not hypothetical): `renderInline` recurses, so it must build a fresh regex per call** — a shared module-level global regex carries `lastIndex` on the object; the recursive call reset it and sent the outer loop back to 0, re-matching the same `**bold**` forever until the 2GB renderer heap died. Any message with bold crashed the app on open.
- **Tool activity is persisted, not just streamed**: `messages.tool_calls` column (JSON `[{name, success}]`; migration follows the migrated-column rule), written on the assistant row, returned by `message:list`, rendered as the same `ToolActivity` collapsible above the reply — what the assistant *did* stays visible after the turn and across reopens. Rows get kind-of-work icons (globe = web/http, terminal = bash, file = read/write/patch, brain = memory, notebook = kb, checklist = todo/think/delegate, git; wrench fallback); failures tint danger with an "N failed" note. `AgentResult.toolCalls` gained `success`.
- **Forked branches show inherited history**: `message:list` walks ancestry via prompt-engine's own `getAncestryMessages` (the SAME walk prompt assembly uses, so the visible transcript can't drift from what the model sees), flags rows `inherited`, and the page renders them read-only (copy only — turn-based edit/retry/delete would mutate the ancestor) above a "Forked here" rule marker.
- **Assistant hover actions**: copy, regenerate (last turn), **Branch from here** (`branch:create` + `forkAtIndex` = that turn — inherits up to and including it, per `context.ts`'s slice), **Pin** (`branch:pin-add`; pins genuinely feed prompt assembly), timestamp, mono model name (`message:list` now returns each row's stored `model`). User rows: edit-and-resend (discards everything after; banner + cancel), copy, retry, delete-pair.
- **Model switcher moved composer → topbar** (right-aligned after the breadcrumb, branch pages only): two composer iterations failed — a boxed Combobox read as a chip-inside-a-chip, and any quiet variant still sat in the bottom-anchored action row that drifts away from tall drafts. It's a branch-level setting, so it lives with the branch identity; quiet mono trigger in the topbar's own hover language, popup `align="end"`. `Combobox` grew `side`/`align`/`sideOffset` + per-item `icon` (provider mono marks via `ProviderTile` — catalogue order groups providers implicitly).
- **Provider plumbing fixed while wiring this**: every provider now sends the config's `maxTokens` (was: defined+validated in config.yaml but sent by NOBODY except Anthropic's hardcoded 8192; unbounded free-tier runaways were a crash risk) — EXCEPT Codex, whose backend-api 400s on `max_output_tokens` (limits are server-side). MCP quick-connect presets swapped Linear/Sentry/Stripe (no icon assets) for Canva/Slack (official endpoints verified); `ProviderTile` now brightens on row hover for mono-only brands (elevation + tone, not just color-swap brands).

### 2026-07-07 (later) — Organization settings become real; the first working override

- **Providers page** (`/settings/providers`, second item in the General nav group): Codex OAuth account row (Connect / Switch account / Sign out via the existing codex channels) + the global API-key list (`config:keys` status query → `config:set` apiKeys patches, saveConfig semantics).
- **Provider row anatomy** (first cut — a wall of 16 always-open password inputs — rejected as "very basic"): `ProviderRow` = neutral tile that goes **raised when active** (elevation means state; no colored chips), name + soft-success status badge ("Active"/"Connected"/"Override"), hint line ("Get a key at console.anthropic.com" when unset; scope semantics when set), actions trailing. **The key input exists only while adding/replacing** (Add key/Replace → autofocused field, Enter saves, Esc cancels via a cancelled-ref guard so the blur-save doesn't fire) — the list reads as state, not a form. Providers with keys sort to the top. `ProviderKeyRow` is the shared scoped-key control (org page passes Override/inherits hints); extend it when project keys land.
- **Provider logos** (`components/provider-logos.tsx`): `@lobehub/icons-static-svg` marks inlined via Vite `?raw` (declared in `svg.d.ts`). `ProviderTile` is the shared tile: mono mark in the tile's state tone at rest (fg-subtle → fg), and — user-directed refinement of the no-category-color rule — brands with a `-color` variant switch to it **while active or while the enclosing `group/row` is hovered**: brand color as state/interaction signal, never at rest. Brands without a color variant (Anthropic, OpenAI, xAI, Notion, GitHub — monochrome marks anyway) stay mono; services missing from the set (Linear, Sentry, Stripe) fall back to monogram tiles. `google` maps to the Gemini mark, `codex` has its own. Rows that host a tile carry `group/row`.
- **Per-provider model management** (`/settings/providers/:provider`): active provider rows click through (identity area navigates, trailing chevron signals it; key actions unaffected) to a page listing the provider's full catalogue — checkbox per model, search, Enable/Disable all, "N of M shown in selection menus". Persisted as `disabled_models` in config.yaml (**disabled-list semantics so newly released models appear automatically**), keyed by router entry name. `models:list` now returns the filtered catalogue (every picker inherits it — the default-model combobox already does); `models:all` serves the management page; **routing is deliberately unfiltered** so branches pinned to a hidden model keep working. Rows stay navigable even with zero enabled models — a filtered-count gate would lock users out of re-enabling.
- **MCP page** (`/settings/mcp`, third item in the General nav group): "Your servers" row-group with live status badges mapped from `MCPStatus` (Connected/Needs auth/Failed/Reconnecting…/Disabled — the one place badges use the full status palette, because MCP connections genuinely have five states), tool counts, Authenticate (opens the OAuth URL externally) / Reconnect / Remove. "Quick connect" presets for the official remote servers (Notion, Linear, GitHub, Figma, Sentry, Stripe — stable public endpoints only; per-account-URL services like Zapier go through the custom dialog), each hiding once connected. "Add custom server" dialog: name + transport segmented control (HTTP/SSE/Command) with conditional URL/command fields (mono). Backend was already complete (`mcp:add/remove/reconnect` + config.yaml persistence) — this was pure UI.
- **The page now states consequence, not just config** (user: "something is missing"): header counts total available models; active key rows say "N models available via this key" (`models:list` is keyed by router entry name — codex maps to `codex_oauth`); the API-keys section hint carries "N of 16 configured"; unset rows link out to the provider's key console (plain `target="_blank"` — the window-open handler already routes to the system browser); a **Defaults section** (mono `Combobox` over all available models → `config:set defaultModel`) ties providers to what chats actually use; and the unset long tail collapses behind "Show N more providers" (popular four stay visible) so the list reads as *your setup*, not a catalogue.

- **Org settings page built** (`/settings/organization/:orgId`): Projects list (row-group; click-through to each project's settings; ⋯ menu with View project → makes it the workspace selection and goes Home, Move to organization ▸ submenu, Remove from organization, Delete project via the shared challenge dialog), Organization name (save on blur), **API keys**, Danger zone (Delete organization — typed challenge "I understand, delete organization", HARD-deletes every project the project:delete way; the last org can't be deleted).
- **"Remove from organization" = move to the first (seed "Personal") org** — projects always need a home (`org_id NOT NULL`), so orphaning isn't a thing; hidden when viewing that org itself. Revisit if a real "personal vs orgs" distinction lands in the model.
- **Org API keys are the cascade's first working override**: keys live on the org row (JSON column; renderer only ever learns *whether* a provider key is set, never the value), and `chat:send` routes through a per-org `Router` built from global config + org overrides (`Router.fromEnv(keyOverrides)`), cached per org and invalidated on `org:set-keys` / `config:set`. Key rows say "Overrides the global key." / "Inherits the global key." — that inheritance language is the pattern for every future scoped setting.

### 2026-07-07 — Project settings: the first real page

- **CSP gotcha (fixed)**: `index.html`'s policy was `default-src 'self'` only, so `img-src` blocked BOTH `data:` URLs (stored project icons) and `blob:` URLs (decoding a freshly picked file) — icon upload failed with "Couldn't read that image". Policy now includes `img-src 'self' data: blob:`. If a future feature loads images from http(s) (remote avatars, artifact previews), extend `img-src` deliberately.

- **`/settings` is no longer a placeholder** (`components/settings-page.tsx`): a **left settings-nav that scaffolds the whole override cascade** — General ▸ Organizations (ALL orgs listed) ▸ Projects (ALL projects of the selected org; picking an org swaps the group). Settings browsing is deliberately independent of the workspace's active org/project: routes carry entity ids (`/settings/organization/:orgId`, `/settings/project/:projectId`; bare `/settings` → general, legacy `/settings/project` redirects to the active project's page), backed by a new `project:get` IPC so a project page resolves its own org. The org owning the listed projects stays text-emphasized even when a project route is active. Sidebar gear → General; rail tile menu → that tile's project settings *without* switching the workspace's active project. General holds the working theme control (`useTheme`); org pages are honest placeholders naming what will land there (API-key overrides, members). Identity fields save on blur, errors toast, no Save button; the icon uploader canvas-crops to a 128px PNG data URL shown on the rail tile and the settings-nav item. Deleting a project from settings lands one scope up (its org's page).
- **Settings grammar — four iterations to get here**: (1) floating rows with full-width separators → rejected ("off"); (2) titled sections + bordered row-groups in a narrow centered column → "lots of empty space, doesn't feel like settings"; (3) label-left / control-right `FieldRow`s + segmented scope tabs → user pushed back on tabs (scopes are a *cascade*, not siblings; each scope grows its own section list; override UX needs scope always visible); (4) scope-grouped left nav. Lessons: label-over-field stacking wastes the horizontal axis, and tabs can't carry hierarchical scopes. **Backend note for whoever builds org settings**: add a single config resolver (project → org → global) first; per-consumer precedence will drift.
- **Row grammar**: trailing chevron = navigates away (Manage artifacts → `/artifacts`, Manage memories → `/memories`, both new placeholders); the system-prompt row expands in place, so its *trailing* caret rotates down instead — `CollapsibleTrigger` gained a `caret={false}` prop for exactly this (place your own caret in children, styled via `group-data-[panel-open]/collapsible:rotate-90`). Delete project sits alone in the Danger-zone group and opens the shared `DeleteProjectDialog` (extracted from the rail tile so both surfaces use one counted+challenged confirm).
- **Project model grew `icon` / `description` / `systemPrompt`** (`project:update` partial-patch IPC). The system prompt is live, not stored-only: chat:send layers "PROJECT INSTRUCTIONS" between the app boilerplate and the conversation context.
- Settings always target the **active** project (rail tile menu → Settings activates first); field state is keyed by project id so switching projects resets cleanly.

### 2026-07-06 (third session) — Spaces and chats get their management context menus

- **Space and chat rows now carry context menus** (Rename / Delete), same pattern as branch rows: `ContextMenuLabel` header inside a Group (gotcha #3), row holds its hover state while its menu is open via `group-data-[popup-open]/space` (resp. `/chat`). With this, every level of the tree (space / chat / branch) has its management menu on the row that owns the object.
- **Chat delete confirm counts branches**: `chat:impact` mirrors `space:impact` — "N artifacts, N memories and N branches" — and `deleteChat` now cascades to its branches' artifacts (it previously left them listed at project level).
- **Chat rows navigate, GitHub-style (user reopened the pure-accordion decision)**: clicking a chat lands on its trunk (oldest live branch — "main" unless deleted) *and* expands the list; a separate caret button toggles without navigating. **Single-branch chats collapse to a leaf row** — no caret, no branch list (a spacer keeps names aligned) — so the tree matches the mental model "the chat *is* the conversation" until a fork makes structure real. When on a non-trunk branch with the list collapsed, the chat name brightens to say "you're in here". Rationale: main is the stable trunk the user always returns to; topic branches (flights / food / places) fork off and later merge back as facts/decisions — the extra chat ▸ main click punished the 90% single-branch case.
- **Every chat is born on "main"**: `createChat` auto-creates the trunk (with the configured default model); a migration backfills branchless chats, and reopening the app restores a trunk to any chat whose branches were all deleted. "No branches yet" can no longer happen in practice. The chat context menu gained **New branch** (forks the trunk at its head — the branch-row Fork stays for forking non-trunk branches).
- **Known trade-off**: while a chat has a single branch, that branch's own row (rename/export/delete-branch) is hidden — its manageable object is the chat. Revisit if users ask to rename "main".
- **Project rail tiles gained the management menu + drag-reorder**: right-click gives Rename / Settings (activates the project, then `/settings`) / Delete with the counted confirm ("N spaces, N artifacts, N memories and N chats" via `project:impact`). Tiles drag to reorder — the rail live-previews the new order while dragging (no drop indicator), dragged tile at 40% opacity, order persisted via `project:reorder` (`sort_order` column; creation-time values mean new projects append after any explicit 0..n reorder). Deleting the active project routes home; the workspace provider already re-defaults to the first remaining project.
- **Project delete is the app's one HARD delete, gated by a typed challenge**: `ConfirmDialog` gained an optional `challenge` prop — the danger button stays disabled until the user types the exact phrase ("I understand, delete project"); Enter submits once unlocked, the phrase is `select-all` for visibility but must be typed/pasted deliberately. Deleting a project permanently removes DB rows (soft-deleted ones included), scoped memories, **and its knowledge-graph nodes** (`MetaGraph.removeByBranches` matches `meta._branch`). Space/chat deletes stay soft and keep the graph — the copy in each dialog states which world it lives in. Rationale: "git for context" never destroys context *within* a project, but discarding an entire project is a deliberate, irreversible act and the friction should say so.
- **Delete confirm states its cost**: a new `space:impact` IPC counts what goes with the space — "N artifacts, N memories and N chats" — and the copy says knowledge-graph entries stay (the graph is a separate store, so that's true, not marketing). Counts are fetched when the user picks Delete; on IPC failure the dialog falls back to "everything in it" rather than blocking.
- **`deleteSpace` semantics changed underneath** (backend): it used to move chats to the oldest remaining space and refuse to delete the last space; now it soft-deletes the space and cascades (chats → branches → artifacts, plus chat-/branch-scoped memories in GlobalMemory). Spaces gained a `deleted_at` column (migration follows the migrated-column-index gotcha). Deleting the last space is allowed — "General" is recreated on demand.

### 2026-07-06 (second session) — App shell built; sidebar iterated with the user in the live app

- **Spaces became the sidebar's organizing concept** (user sketch): a space (Design / Development / Business…) contains Memories, Artifacts, and Chats; chats are **pure accordions** — you always navigate to a *branch* (git semantics: you're never "in the repo," always on a branch). Backed by a real `Space` entity (see ONBOARDING).
- **Header hierarchy inverted after the first cut failed**: org-led header made the rail's initial tiles read as avatars. Now the **project name is the headline** with the org as a small eyebrow menu (caret hugging the text) — rail tile and header visibly name the same thing.
- **Breadcrumb moved off the sidebar**: it starts over the page card (topbar's left zone mirrors the chrome width) instead of rendering project info above the sidebar's own header. Collapsing the sidebar slides it left, Notion-style.
- **Branch names in nav rows: sans, not mono** (user overruled) + `GitBranchIcon` carries identity. Mono-for-data survives in *content* (breadcrumb branch segment, model names, costs).
- **Context menu lives on branch rows, not chat rows** (first cut had it on the chat container — wrong object). Menu is headed by a "chat / branch" `ContextMenuLabel` (inside a Group — gotcha #3), and the row **holds its hover state while its menu is open** via `group-data-[popup-open]` so the menu's target is unambiguous next to the active-route row's raised state.
- **Search bar raised** (`surface-2` + `shadow-raised`, the select-trigger "closed popup" language) — it was field-styled and read sunken next to the kbd chips.
- **Fullscreen adaptation**: macOS hides traffic lights in fullscreen; main pushes `window:fullscreen-changed` and the topbar collapses the reserved 76px to 12px, animated.
- **Spacing pass** (user-tuned): nav rows 4px apart, tree rows 2px + breathing room around nested groups; rail 64px with 40px tiles.
- **Honest empty/error states**: IPC failure shows "Couldn't load spaces" + retry — never the empty-state message (the first version masked a migration crash as an empty project). Empty states carry their own inline action.

### 2026-07-06 — ButtonGroup gains a selected state (`ButtonGroupItem`)

- User flagged that ButtonGroup had no selected/highlighted state, though both gallery demos (alignment icons, Day/Week/Month) are really segmented controls. ButtonGroup now has two modes: plain `role="group"` div for action clusters (unchanged), and — when `value`/`defaultValue`/`onValueChange` is passed — a Base UI **ToggleGroup** (arrow-key focus, `aria-pressed`) with `ButtonGroupItem` children.
- **Selected style speaks the tabs language:** rest `surface-1`/muted text → hover `surface-2` → pressed `surface-3` + `shadow-raised` + `border-line-strong` (raised = selected). Pressed segment gets `z-[1]` so its stronger border wins the collapsed `-ml-px` overlap; hover styles are scoped to `:not([data-pressed])` so hovering the selected segment doesn't drop it back down the ramp.
- Single-select with string-valued API (`value: string`, like Combobox); re-clicking the pressed segment is ignored so the control never goes empty — add a deselectable prop only when a page needs it.
- Button size classes extracted to `buttonSizes` (exported from `button.tsx`) so segments and buttons can't drift.

- **Palette: warm mono adopted, navy+ember superseded.** Side-by-side comparison (`design-comparison.html`); ember felt riskier (warning-color and Claude-brand adjacency), cool mono looked like the rejected "clinical ChatGPT" gray.
- **Component stack: Base UI replaces Radix** (Radix unmaintained; shadcn itself moved). All `@radix-ui/*` removed. Hybrid strategy: hand-written visual primitives, Base UI for behavioral, `@shadcn/react` for message-scroller, cmdk + sonner kept.
- **tailwind-merge extended** (`lib/utils.ts`) after it silently dropped `text-primary-fg`/`text-white` from buttons — custom `text-*` sizes were classified as colors (invisible-label bug in both themes).
- **`pressable` now owns the full interaction transition** — stacking `transition-*` utilities on it clobbered either press-scale or hover-color (CSS shorthand conflict).
- **Light-mode danger softened** `#DC2424` → `#DD4938` — deep red read too harsh against the warm canvas.
- **Badges: `*-text` status tokens added** (text a tone deeper than the tint; brighter in dark mode) + roomier pill (`px-3.5 py-2`, 13px, user-tuned) — matching a reference the user liked; solid-on-tint text read washed out.
- **Fields un-sunk after two rejected attempts:** `bg-canvas` (invisible on canvas) then `bg-sunken` ("dark black pit" in dark mode). Now: inputs rest at `surface-1`, focus lifts to `surface-2`; select/combobox triggers are raised controls in the popup's own surface language, 13px label text, single rotating chevron. `sunken` survives only in the switch track.
- **Composer focus glow added** (`shadow-glow`): warm emitted light in dark, halo + deepened ambient in light — chosen over a Dia-style blue glow to stay "candlelit".
- **Tooltip: in-theme raised chip** — the first version was an inverted fg-on-canvas chip (macOS-style); user read light-on-dark as a theming bug.
- **Tabs: selected state fixed + sliding indicator.** Original styles targeted `data-selected` but Base UI emits `data-active` (selection was literally invisible); replaced static selected bg with a raised indicator rectangle that slides via `--active-tab-*` vars.
- **Micro-interactions pass:** checkbox/radio indicators pop in with spring (`keepMounted`), slider thumb grows on hover/drag (track deliberately not eased — feels laggy), message actions reveal on hover *and* focus-within, tooltip clusters share a provider for instant-on-sweep.
- **Marker vs Highlighter split:** user renamed the text-highlight `<mark>` component to `highlighter.tsx`; `marker.tsx` is the chat-timeline event row (shadcn-style Marker/MarkerIcon/MarkerContent + `rule` divider variant).
