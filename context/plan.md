# plan.md — Tool-call transparency: open the black box

Feature tracker (started 2026-07-13). Read `DESIGN.md` for the design system and `ONBOARDING.md` for project state. Check tasks off as they land; note deviations inline.

## The problem (user, with screenshots)

Tool activity is a black box. Rows say `bash` / `web_fetch` / `web_search` but not *what* ran: which command, which URL, which query. `argsPreview` (2026-07-13) shows raw truncated JSON — better than nothing, not an answer. There's no way to see a call's full args or its result. And model thinking/reasoning is invisible end-to-end: providers don't even parse it off the wire.

## Decisions (design of record)

- **Rows lead with the salient argument, not JSON**: `bash` → the command, `web_fetch` → the URL, `web_search` → the query, file tools → the path, `subagent`/`delegate` → the task, MCP tools → best-effort first meaningful string field. One shared extractor — `toolCallSummary(name, args)` in `@ai-studio/shared` — used by the renderer (live, from `tool_start` args) and main (persisted as `summary` on `MessageToolCall`), so live and reopened rows can't drift.
- **Rows are expandable**: clicking a tool row toggles an inline detail panel — full args (pretty JSON, mono block) and the result (mono, scrollable). New persisted fields `args` (≤4k) / `result` (≤6k) with visible truncation markers; live rows capture the same from `tool_start`/`tool_end` events (which already carry full args/result — we were dropping them).
- **`argsPreview`/`resultPreview` stay untouched** — they are the model-facing trail (`withToolTrail`), a different consumer with different caps. UI reads `summary`/`args`/`result`, falling back to `argsPreview` for pre-existing rows (not expandable — the data was never stored).
- **Thinking becomes a first-class stream event**: `{type: "thinking", text}` on provider `StreamEvent` → `AgentStreamEvent` → `chat:stream`. Parsed wherever a wire format carries it (see Part C). Persisted per assistant message (`messages.thinking` column, ≤24k) and rendered as a collapsed "Thinking" collapsible above tool activity — live-streaming while the model reasons.
- **Parse-only for request-side thinking, except Codex**: Codex responses get `reasoning: {summary: "auto"}` (all codex models are gpt-5.x reasoning models — this is what makes thinking visible for the user's daily driver). Anthropic (`thinking: {budget_tokens}`) and Gemini (`thinkingConfig.includeThoughts`) need opt-in request params — deferred until a thinking config exists; the parsers are ready when they arrive.
- **Thinking does NOT ride the hot window** — models shouldn't be fed their own stale reasoning; the trail (argsPreview) is the model-facing memory, thinking is user-facing visibility.
- **Interleaving accepted limit (v1)**: one thinking block per turn (segments joined), above the tool list — not a full timeline of thinking↔tools ordering. Revisit if it hurts.
- **Subagent thinking**: not folded into transcripts v1 (their drawer already shows full text+tools); noted as follow-up.

## Part A — salient summaries

- [x] `toolCallSummary(name, args)` in `@ai-studio/shared` (new `tool-call.ts`): known tools (bash/web_search/web_fetch/read_file/write_file/edit_file/list_files/glob/grep/remember/kb_*/skill/subagent/delegate/think→reasoning) + MCP heuristic (preferred keys: url, query, path, title, name, prompt, text, id…) + compact-JSON fallback. Caps at 200 chars. Unit-tested.
- [x] `MessageToolCall.summary` persisted (built in chat:send from full args); renderer computes the same live.
- [x] Row shows summary (mono, subtle, truncating) — falls back to `argsPreview` on old rows.

## Part B — expandable detail

- [x] `MessageToolCall.args` (pretty JSON ≤4k) + `result` (≤6k) persisted with truncation markers (`clipText` helper shared with live path).
- [x] Renderer: `tool_start` keeps full args; `tool_end` attaches result to the matching running call (same caps via shared helpers).
- [x] ToolActivity rows become buttons → inline detail panel (args block + result block, mono 11px, `max-h` scroll, danger tint on failed result). Caret affordance on rows that have detail. Subagent per-agent rows keep their drawer.
- [x] Store: no schema change needed (`tool_calls` is already a JSON column); round-trip test for the new fields.

## Part C — thinking

- [x] `StreamEvent` + `AgentStreamEvent` gain `{type: "thinking", text}`.
- [x] Providers parse thinking where the wire carries it:
  - [x] anthropic: `content_block_delta` → `thinking_delta` (`delta.thinking`); `redacted_thinking` ignored.
  - [x] openai_compatible + openrouter + openai + azure + cloudflare (chat-completions delta shape): `delta.reasoning_content ?? delta.reasoning` (DeepSeek / OpenRouter conventions).
  - [x] google: streamed parts with `part.thought === true`.
  - [x] bedrock: `contentBlockDelta.delta.reasoningContent.text`.
  - [x] codex_oauth: `response.reasoning_summary_text.delta` (+ `response.reasoning_text.delta`); request adds `reasoning: {summary: "auto"}` with a 400-retry-without fallback (defensive — the Codex CLI always sends it).
- [x] Agent loop forwards thinking events + accumulates `AgentResult.thinking` (joined, includes rejected-draft iterations — it's process visibility).
- [x] chat:send forwards thinking on `chat:stream`; persists on the assistant message (≤24k cap).
- [x] Store: `messages.thinking` column (migrated-column rule — no index needed), `addMessage` param, `rowToMessage` parses; `Message.thinking?`.
- [x] Renderer: thinking deltas rAF-batched like text; "Thinking" collapsible above tool activity — spinner + live text while streaming, collapsed by default once done; muted styling. Persisted messages render the same block.
- [x] Tests: provider parsers (anthropic/openai_compatible/codex fixtures), agent accumulation, store round-trip.

## Part B.2 — detail visibility toggle (user feedback on the live feature)

- [x] Settings → General → new "Chat" section: "Tool call details" Switch. Off = rows keep the salient one-liner but don't expand (no caret, not clickable). On by default.
- [x] `toolCallDetail` pref in `UiPrefsProvider` (localStorage, per-device) — presentation, not config.yaml.

## Part D — docs & closeout

- [x] ONBOARDING.md + DESIGN.md changelog entries.
- [ ] Clear this file when accepted.

## Verify (user, after restarting `yarn dev` — main process + packages changed)

1. Send a message that triggers tools: rows should read `bash npm test`, `web_fetch https://…`, `web_search rust async runtime` — not raw JSON.
2. Click a row → args + result expand inline. Old messages: rows render as before, not expandable.
3. On a codex (gpt-5.x) branch, ask something non-trivial → "Thinking" block streams live above the reply, collapses when done, survives reopen.
4. MCP tool calls (e.g. notion-search) show the query/title argument.

## Known limits (accepted)

- One thinking block per turn — no thinking↔tool interleave timeline.
- Anthropic/Gemini thinking needs request-side opt-in (no config for it yet) — parsers are ready.
- Subagent transcripts don't capture thinking yet.
- Pre-existing rows carry only the old previews (no migration — data wasn't stored).
