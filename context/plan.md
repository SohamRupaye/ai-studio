# plan.md — Subagents: reliable model routing + live visibility

Feature tracker (started 2026-07-11). Read `DESIGN.md` for the design system and `ONBOARDING.md` for project state. Check tasks off as they land; note deviations inline.

## The problem (from live use)

1. **Subagents fail on hallucinated models.** The `subagent`/`delegate` tool schemas invite an optional `model` param; the main model invents ids ("current", "gpt-4.1-mini"), `t.model || _defaultModel` trusts them, and the router throws `No provider for model` — the whole delegation dies instead of falling back to the chat's model.
2. **Subagents are a black box.** The UI shows a single "subagent" tool row; there's no way to see what each of the (up to 4) agents is doing, live or after the fact.

## Part A — model fallback (backend fix)

- [x] `runTask` (ai-core `runtime.ts`): if running the requested model throws `No provider for model` and it differs from the default, retry once on the default model and prefix the result with a one-line note ("requested model X unavailable — ran on <default>"). Catch at run level, not a pre-check, so prefix routing and live model-list refresh keep working.
- [x] Tighten `model` param descriptions on `subagent`/`delegate` defs: exact id from this workspace only, omit when unsure — don't guess ids.
- [x] Regression tests in `ai-core/__tests__/runtime.test.ts`: unknown model falls back + notes; valid override still routes.

## Part B — per-subagent visibility (backend plumbing + UI)

Backend:
- [x] Extend `RunTask` with `meta { runId, agentId, task }`; `setSubagentDependencies` gains an optional `onEvent` emitter (tools-runtime holds the types).
- [x] `runtime.ts` emits lifecycle events while running each subagent: `start` (task, model), `tool` (each tool_start — "what it's doing now"), `done` (final text), `failed` (error). `createRuntime` gains an optional `onSubagentEvent` param.
- [x] `subagent` handler generates a `runId` per invocation + passes each task's `agentId`; `delegate` passes `job_id`.
- [x] `chat:send` (main) forwards events on `chat:stream` as `{ type: "subagent", branchId, ...event }` and collects them per turn; on done, tool_calls entries for `subagent`/`delegate` calls persist an `agents` array (matched to invocations by runId order) — task, model, tool trail, status, result — so the detail survives reopen.
- [x] `message:list` returns the extended tool_calls untouched (JSON pass-through — verify, don't rebuild).

Renderer (`chat-page.tsx`):
- [x] Stream state gains a subagent map keyed by agentId; `chat:stream` listener handles `type: "subagent"`.
- [x] `ToolActivity`: `subagent`/`delegate` rows expand into per-agent rows — status spinner/check, agent label, mono model, current tool while running.
- [x] Clicking an agent row opens a detail Dialog: full task, model, tool trail, result (Markdown) or error. Works live (streaming state) and on persisted messages.

- [x] Tests: runtime event emission + fallback; store round-trip of tool_calls with `agents`.
- [x] Docs: ONBOARDING (backend) + DESIGN changelog (UI), then clear this file when the feature is accepted.

## v2 (2026-07-12 feedback: "working means what? I want the entire process" + 3-min silent run)

- [x] **Full transcript streaming, not just tool names**: runtime emits `text` deltas, `tool` (with compact args preview), and `tool_end` (success + result preview) per agent. Trail folds into `steps` (interleaved text/tool) via a single shared reducer (`applySubagentEvent` in `@ai-studio/shared`) used by BOTH main (persistence) and the renderer (live view) — they can't drift.
- [x] **Modal → non-modal Drawer** (per DESIGN's own rule: Dialog = focused forms, Drawer = reference panels): right-side drawer, no backdrop, `modal={false}` — watch the agent while the chat keeps streaming. Auto-follows the transcript while running.
- [x] **Elapsed time** on agent rows and the drawer header (live ticker while running, persisted `durationMs` after).
- [x] **Hard timeout**: no run can hang forever — subagent tasks 5 min, delegate jobs 10 min (`timeoutMs` on `SubagentRunMeta`, abort signal into `agent.run` + event-loop backstop for providers that ignore it). Timed-out runs fail visibly ("Timed out after Ns").
- [x] Renderer frame-batches subagent events (they now arrive per token × up to 4 agents) on the same rAF flush as main text.
- [x] Tests: reducer transcript-building, timeout kill, text-event emission; store round-trip updated to `steps`.

## Known limits (accepted for now)

- `delegate` (background) jobs that finish after the turn persist as "running" in the message record; live status still streams while the page is open, and `delegate_result` remains the model-facing check. Revisit if background jobs get real UI.
- Old records persisted before transcripts existed carry `tools: string[]` — the renderer normalizes (`steps ?? []`) instead of migrating.
