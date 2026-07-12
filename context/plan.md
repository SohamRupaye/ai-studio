# plan.md — Skills: real end-to-end integration

Feature tracker (started 2026-07-12). Read `DESIGN.md` for the design system and `ONBOARDING.md` for project state. Check tasks off as they land; note deviations inline.

## The problem

Skills exist only as scaffolding — nothing is user-reachable:

1. **Two incompatible, unwired implementations** in `packages/tools-runtime/src/skills/`: `index.ts` (`SkillsService` — YAML-frontmatter `SKILL.md`, multi-dir + remote discovery, permission filtering, LLM formatting; **never instantiated anywhere**) and `runner.ts` (simple `## description/tools/instructions` markdown; wired to `skills:list` IPC but its `buildSkillPrompt` is never called outside tests).
2. **No frontend**: composer attach-menu "Skills" item is a dead label (no onClick), `useSkills` hook exists but no component consumes it, no settings page, no management of any kind.
3. **No slash commands**: no `/` parsing in the composer or `chat:send`.
4. **No import/download**: `SkillsService.pullRemoteSkills` implements remote fetch but is unreachable.
5. Aspirational stubs that anticipate skills: `protectedTools: ["skill"]` in prompt-engine pruning, persona `allowedSkills`/`deniedSkills` (never read), registry comment about a "skill tool" that doesn't exist.

## Decisions (design of record)

- **One format: YAML-frontmatter `SKILL.md`** (`name`, `description` + markdown body) — the ecosystem standard (Claude Code / anthropics-skills style), so downloaded/imported skills just work. A skill is a **directory** containing `SKILL.md` (+ optional supporting files, referenced relatively). `runner.ts`'s `## sections` format is retired — absorb anything useful, delete the rest (its tests go with it).
- **Storage: file-based, no DB table.** Installed skills live in `<dataDir>/skills/<skill-name>/SKILL.md`. Enable/disable = `disabled_skills` list in config.yaml (same disabled-list semantics as `disabled_models` — new skills appear enabled automatically).
- **Two invocation paths, same skill:**
  - **User-invoked (slash command)**: typing `/` at the start of the composer opens skill autocomplete; picking one injects the skill's body into that turn's prompt (visible marker in the transcript that a skill ran).
  - **Model-invoked**: enabled skills' name+description go into the system prompt as `<available_skills>`; a new `skill` tool loads a skill's full body on demand (this is what pruning's `protectedTools: ["skill"]` always anticipated). Progressive disclosure — bodies are never all preloaded.
- **Scope: global only for now** (one skills dir for the whole app). Space/project-scoped skills are a later cascade feature, same as keys.
- Persona `allowedSkills`/`deniedSkills` stay unwired for now — noted, not built.

## Part A — backend consolidation

- [x] Consolidate on `SkillsService` as the single implementation — rewritten (`tools-runtime/src/skills/index.ts`): one managed dir, `importFromPath` (folder or bare .md), `importFromUrl` (raw SKILL.md or index.json catalogue, path-traversal-guarded), `remove`, `startWatching` (recursive fs.watch, 500ms debounce), `parseSkillFile` validation on every install path. `runner.ts` + tests deleted. *Deviation: multi-location scanning (~/.claude etc.) and the remote cache dir were dropped, not ported — one managed dir is the product model; import covers external skills.*
- [x] Config: `disabled_skills` in config.yaml (loader + saveConfig round-trip, tested).
- [x] `skill` tool registered in main. *Deviation: static description — the agent loop reads `getDefinitions()`, which never calls `dynamicDescription`; the live list rides the system prompt instead (rebuilt per turn anyway). Execute returns the body + a pointer to the skill's directory for relative file references.*
- [x] `<available_skills>` block in `buildBaseSystem` (enabled + described skills only, one line of semantics, names the `/` invocation).
- [x] IPC: `skills:list` (enabled/path/description), `skills:read`, `skills:set-enabled`, `skills:remove` (also drops the stale disabled entry), `skills:import` (native picker, per-file outcomes), `skills:pull`, `skills:reveal` (show in Finder), `skills:changed` push (watcher + mutations).
- [x] Slash execution in `chat:send`: leading `/name` that matches an *installed* skill injects its body as a binding `<invoked_skill>` system block; the persisted message keeps the raw text. Disabled skill → friendly error, no model call, nothing persisted. *Deviation: an unknown `/name` passes through as a normal message rather than erroring — "/etc/hosts is broken" must not bounce; autocomplete makes typos unlikely.*
- [x] Tests: 23 service tests (discovery, frontmatter, import validation incl. collisions, remove, deny-filtering, URL pull against a real local HTTP server) + 2 config tests. *Deviation: no direct chat:send test — main-process handlers have no test harness (pre-existing); the resolution regex + service are covered.*

## Part B — frontend

- [x] **Settings page `/settings/skills`** (General nav group, after MCP servers): installed row-group — `/name` in mono, description hint, enabled Switch, ⋯ menu (View instructions → Markdown in a 560px right Drawer (was a modal — cramped for long bodies; Dialog=forms, Drawer=reference) / Show in Finder / Remove with ConfirmDialog). Footer split-buttons: **Import skills** (native picker) · **Add from URL** (dialog). Empty state explains the SKILL.md format.
- [x] **Composer slash autocomplete**: leading `/` opens an anchored panel above the composer (prefix-filtered live, ↑/↓ + Enter/Tab select, Esc dismisses — typing revives it); selecting writes `/name ` into the draft. *Deviation: no chip in the composer and no cmdk — the message text itself IS the command (that's also what persists), and a lightweight inline list beats wiring cmdk outside its dialog idiom.*
- [x] **Attach menu "Skills" item wired**: opens the same panel in browse mode (all enabled skills; selection prefixes the draft). Empty state links to Settings → Skills.
- [x] **Transcript marker**: user turns starting with `/name` (name matches an installed skill) render the token as a Lightning chip above the message text — derived from content, no metadata to drift. Applied to persisted and optimistic bubbles.
- [x] `useSkills` consumed (chat page + settings); `useSkillsChangedListener` mounted in App.tsx.
- [x] Gallery: left as-is deliberately — every item in its attach-menu demo is decorative; the real picker lives on the chat page.
- [x] `Composer` gained a `textareaRef` escape hatch (refocus after picker insert) — DESIGN.md changelog.

## Part B.2 — GitHub install (feedback: skills ship as GitHub repos — skills.sh / `npx skills add <repo> --skill <name>`)

- [x] `SkillsService.discoverFromUrl(url)`: GitHub repo URLs (`github.com/owner/repo`, `/tree/branch/subpath`, `/blob/…/SKILL.md`, `owner/repo` shorthand) resolve via the GitHub API — default branch lookup → recursive tree → every `SKILL.md` in scope; each candidate's SKILL.md is fetched and validated at discovery time (frontmatter name/description drive the picker). Raw-SKILL.md URLs and index.json catalogues go through the same discovery shape. API/raw hosts are constructor-injectable (test seam). Unauthenticated API (public repos; 403 → human rate-limit message, 404 → "private repos aren't supported").
- [x] `importFromUrl(url, pick?)`: installs discovered skills (all, or the picked names — the `--skill` equivalent); a skill's whole folder comes along (supporting files; a nested folder with its own SKILL.md belongs to that skill and is excluded), 100-file / 5MB-per-file / 50-skill caps, cleanup on partial failure.
- [x] IPC: `skills:discover` (url → candidates + installed flags + skip reasons); `skills:pull` gains `skills?: string[]`.
- [x] Add-from-URL dialog: URL → Find skills → pick-list (checkboxes, installed rows disabled+badged, all new ones pre-checked) → Install N.
- [x] Tests: fixture GitHub API server — discovery with names/descriptions, pick-one install incl. support files, missing pick name, subpath scoping, repo-root skill vs nested-skill exclusion, rate-limit/404 messages; raw/catalogue tests still pass (35 total in the suite now).
- [x] **Bonus (found probing mattpocock/skills live): `disable-model-invocation: true` frontmatter honored** — such skills are slash-only: excluded from `<available_skills>` and invisible to the `skill` tool, but `/name` works; settings row says "Slash-only". Verified against the real repo's grill-with-docs.
- [x] **UX pass on the live page** (user feedback): actions moved from a bottom footer row to the section title row (Rescan icon + Import + Add from URL; new `actions` slot on `SettingsSection`), new `skills:reload` IPC (manual rescan fallback to the watcher, returns count), skills page column widened to `max-w-3xl`, "Installed" section hint shows the count.

## Part B.3 — tool-call amnesia (surfaced live-testing /debate: "what bash commands did you run?" → "I didn't run any")

Two-part root cause: (1) prompt assembly rebuilt hot-window assistant messages as `{role, content}` only — persisted `tool_calls` never reached the model, so it had zero memory of its own actions on later turns; (2) we persisted only `{name, success}` — no args — so even the UI couldn't answer "what commands".

- [x] `MessageToolCall` gains `argsPreview` (≤300 chars, compact JSON) + `resultPreview` (≤200) — built at persist time in chat:send from `AgentResult.toolCalls` (which always had full args/results; we were dropping them).
- [x] `buildPayload` hot window: assistant messages get their turn's trail appended for the model — `[Tool calls you made during this turn: - bash({"command":…}) ✓ → …]`, capped at 12 calls + overflow note. Stored rows and UI content untouched.
- [x] ToolActivity rows show the args preview (mono, truncated, subtle) — live (from `tool_start` events) and persisted; a `bash` row now says *what* it ran.
- [x] Tests: prompt-engine (trail reattachment, user rows untouched, 12-call cap + overflow note).

Note: the OTHER half of that screenshot wasn't a bug — /debate is a cross-tool consultation skill that shells out to `claude`/`gemini` CLIs via bash by design; gpt-5.4-mini was just the moderator.

## Part C — docs & closeout

- [x] ONBOARDING.md (backend section) + DESIGN.md changelog entries.
- [ ] Clear this file when the feature is accepted.

## Verify (user, after restarting `yarn dev` — main process changed)

1. Settings → Skills: import a skill (e.g. a folder with SKILL.md — `~/.claude/skills/graphify` is compatible), toggle it, view instructions. Add from URL: paste `https://github.com/mattpocock/skills` → Find skills → pick e.g. grill-with-docs → Install (note: it's slash-only, the model won't list it).
2. Chat: type `/` → autocomplete; send `/name do something` → chip renders on the turn, reply follows the skill.
3. Ask the model something matching a skill's description without the slash — it should call the `skill` tool (visible in tool activity).

## Known limits (accepted for now)

- Skills are global; no per-space/project scoping yet.
- No skill *authoring* UI (create/edit in-app) — users write SKILL.md files on disk or import; revisit if asked.
- Persona skill gating (`allowedSkills`/`deniedSkills`) remains unwired.
