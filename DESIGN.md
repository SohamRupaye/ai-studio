# DESIGN.md — AI Studio design system & component library

Context doc for whoever (human or agent) builds UI next. Everything described here is **implemented and working** in `apps/desktop/src/renderer/` — this is not a proposal. Read this instead of re-deriving the design system; read `ONBOARDING.md` for project-wide context.

State as of 2026-07-06: tokens + 31-component library complete and demoed in a dev gallery (`components/ui-gallery.tsx`, mounted in `App.tsx`). No app shell or pages yet — that's the next phase. All of this is in the working tree; check `git status`.

**This is a living system, not a spec.** Improve it when a real use case demands it — several of today's best decisions (raised selects, the `*-text` badge tones, the glow) came from exactly that kind of revision. The distinction that matters: *evolve with a reason* (a page needs something the system doesn't do well) vs. *relitigate settled taste* (the warm-mono palette, the one-hero rule, mono-for-data — those stay unless the user reopens them). When you change tokens or component behavior, add a dated entry to the **Changelog** at the bottom of this file saying what changed and why, so the next iteration inherits the reasoning and not just the diff.

## Design direction (settled — don't relitigate)

The user (Soham) rejected two earlier UIs for looking "AI-generated": flat neutral gray, evenly-weighted panels, colored icon chips, generic admin layouts. Reference points: Dia, Arc, Wise, Notion, Sana.

**Rules that survive any redesign:**
- One hero moment per screen (the composer on chat; one primary button anywhere else).
- Depth comes from the **elevation ramp**, never decoration. Raised = lighter.
- Mono font **only for data**: model names, tokens, costs, branch names, numbers. Never prose.
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

## Two hard-won gotchas (violating these WILL reintroduce fixed bugs)

1. **`pressable` owns the entire interaction transition** (transform + colors + shadow + opacity). Never stack a `transition-*` utility on a pressable element — the CSS shorthand conflict silently kills one of the animations. If an element needs press feedback + color transitions, `pressable` alone already does both.
2. **tailwind-merge is extended in `lib/utils.ts`** to know our custom `text-*` tokens are font *sizes* and `shadow-raised/sunken/float/glow` are shadows. Without that registration it classified `text-label-md` as a *color* and silently dropped `text-primary-fg`/`text-white` from buttons (invisible-label bug). If you add new custom `text-*` or `shadow-*` theme tokens, **register them there too**.

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

## Deliberately NOT built yet (build when a page demands it, not before)

- **Popover** (generic anchored panel), **progress/meter** (context-window %), **form field wrapper** (label+error glue for react-hook-form), **scroll-area** (native scrollbars fine for now).
- **Markdown/code-block renderer** — the one important missing piece; it's a content component that must be built against real streamed output on the chat page. The old `markdown.tsx` was deleted; don't resurrect it blindly.

## Next phase

1. Commit the working tree (design system / component library / legacy-page deletions as separate commits).
2. App shell: title bar, sidebar, routing — composed from these primitives, following the elevation + one-hero rules.
3. Chat page: composer + message scroller + message kit + markers + collapsible tool calls + the markdown renderer. Preserved data layer to wire into: `hooks/use-ipc-data.ts`, providers in `components/` (auth, workspace, ui-prefs), `auth-guard.tsx`.
4. Replace `ui-gallery.tsx` with real routes when they exist (it's a dev scratchpad, not a shipping screen).

## Changelog

Dated entries, newest first: what changed and **why**. Add one whenever tokens or component behavior change.

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
