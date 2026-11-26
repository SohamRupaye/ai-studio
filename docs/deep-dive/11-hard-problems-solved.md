# 11 — Hard Problems Solved (Bug & Challenge Stories)

> Write-ups of real debugging challenges from building this project — each one is a real problem with a root cause and a fix. Most have regression tests.

## How these are told

The shape: **symptom → what was first suspected → the actual root cause → the fix → how regression was prevented.** The diagnosis matters as much as the fix.

---

## 1. The model had amnesia about its own tool calls ⭐ (best all-rounder)

- **Symptom:** During live testing, I asked the agent "what bash commands did you run?" and it said "I didn't run any" — right after running several.
- **First thought:** A prompt/persona issue.
- **Root cause:** Two bugs with the same symptom. (1) When assembling the prompt, the "hot window" of recent messages rebuilt assistant turns as `{role, content}` only — the tool calls were stored *separately* (for the UI to render) and never re-entered the model's context. (2) Only `{name, success}` was persisted per tool call — no arguments — so even the UI couldn't say *what* a `bash` call ran.
- **Fix:** Added `argsPreview`/`resultPreview` to the stored tool-call record, and a `withToolTrail` step that reattaches a compact per-turn tool trail (`bash({"command":…}) ✓ → result`) to the assistant text the model sees — capped at 12 calls. Stored rows and UI untouched.
- **Why it's a good story:** classic "the data existed but never reached the consumer" bug, found by *using the product*, fixed at the right layer, regression-tested.

## 2. The "act, don't ask" guard that destroyed good answers

- **Symptom:** A complete, long, correct answer would sometimes vanish when the turn finished and get replaced by a terse reply to a system scolding.
- **Root cause:** A guard meant to stop the model from *deflecting* ("Would you like me to…?" instead of doing the task) was flagging a *full* answer that happened to end with a friendly offer ("If you want, I can tailor this…"). Because the correction path discards the rejected draft, the whole good answer got thrown away.
- **Fix:** The deflection check now only applies to **short** responses (< 400 chars). A real deflection is a question *instead of* an answer; a long answer *plus* a closing offer is not. Also: a separate bug where `AgentResult.text` was only the *last* iteration's text (so "long answer → tool call → short follow-up" persisted only the follow-up) — fixed by accumulating text across iterations.
- **Why it's good:** a guardrail that needed a scalpel, not a hammer — shows judgment about false positives.

## 3. The migration ordering bug that bricked the app on open

- **Symptom:** After adding the `Space` entity, existing databases wouldn't open — the `Store` constructor threw "no such column: space_id."
- **Root cause:** The schema setup runs the entire `SCHEMA` block (all `CREATE TABLE`/`CREATE INDEX`) *first*, then runs `migrate()` (the `ALTER TABLE ADD COLUMN`s). I'd put `CREATE INDEX … ON chats(space_id)` in the `SCHEMA` block — so on an *existing* DB it tried to index a column that only gets added later in `migrate()`.
- **Fix:** Any index on a migration-added column must live *inside* `migrate()`, after its `ADD COLUMN`. Regression-tested with a legacy-DB migration test.
- **Why it's good:** subtle ordering dependency, only reproduces on pre-existing data (not a fresh install), exactly the kind of thing unit tests on empty DBs miss.

## 4. Multi-model delegation was silently dead (dependency-injection bug)

- **Symptom:** Every subagent/delegate call returned "dependencies not initialized," yet the tools were visible to every model.
- **Root cause:** `tools-runtime` can't import `ai-core` (circular), so `ai-core` injects its task runner. But there were **two copies** of the injection point — `ai-core` was setting a *private duplicate* that nothing read, while the real one in `tools-runtime` stayed empty.
- **Fix:** Unified on the `tools-runtime` export; `createRuntime` now calls the real `setSubagentDependencies`, per turn, so subagents inherit the current branch's router and model. Deleted the dead duplicate; added wiring regression tests.
- **Why it's good:** shows understanding of monorepo dependency direction and inversion.

## 5. MCP OAuth "Reconnect does nothing"

- **Symptom:** Clicking Reconnect on an MCP server that needed auth just silently re-hit the same 401.
- **Root cause:** The OAuth flow *was never actually implemented* — the auth methods were stub no-ops, there was no callback server, no `mcp:authenticate` IPC, and the `needs_auth` state never carried a URL so the Authenticate button never even rendered. On top of that the HTTP transport wasn't spec-compliant Streamable HTTP, so even a valid token wouldn't have connected.
- **Fix:** Built the full **OAuth 2.1 client** — RFC 9728 discovery, RFC 8414 metadata, RFC 7591 dynamic client registration, PKCE S256 over a one-shot loopback server, resource indicators, silent refresh — plus a real Streamable HTTP transport (session-id echo, SSE-framed response parsing). Verified live end-to-end against Notion and Canva.
- **Why it's good:** a from-scratch implementation of a real, multi-RFC protocol, tested against fixture servers that actually recompute PKCE — and honest about the "it never worked before" starting point.

## 6. Timeouts when the provider ignores your abort signal

- **Symptom:** A delegated background job ran 3+ minutes with no way to stop it; a task like "work for a minute" made a subagent burn tool-loop iterations forever.
- **Root cause:** There were *no* timeouts, and simply passing an `AbortController` signal to the provider isn't enough — some providers ignore it.
- **Fix:** Hard wall-clock timeouts (5 min blocking, 10 min background) via `AbortController`, **plus an event-loop backstop** that checks `signal.aborted` on every streamed event and throws — so cancellation works even against a provider that ignores the signal. Proven with a test using a generator that streams forever and ignores abort.
- **Why it's good:** defense-in-depth; shows you don't trust external code to honor contracts.

## 7. The shared-regex OOM (frontend)

- **Symptom:** The markdown renderer would eventually blow up memory during long streaming sessions.
- **Root cause:** A `RegExp` with the global flag was shared across calls; global regexes carry mutable `lastIndex` state between invocations, which corrupted matching and spiraled.
- **Fix:** Don't share stateful (global-flag) regexes across calls. (The same footgun appears in the artifact extractor, which explicitly resets `lastIndex` before each scan.)
- **Why it's good:** a genuinely surprising JS gotcha that bites people who think of regexes as pure.

## 8. Frame-batched streaming (frontend performance)

- **Symptom:** Streaming felt janky — and it got worse with subagents (now up to 4 agents streaming per-token simultaneously).
- **Root cause:** Applying every streamed token as its own React state update thrashed the renderer.
- **Fix:** Batch text deltas onto a single `requestAnimationFrame` frame. And critically, main and renderer fold subagent events with the **same reducer**, so the live view and the persisted record are guaranteed identical.
- **Why it's good:** a real rendering-performance problem with a clean fix and a correctness bonus (one reducer, two consumers → no drift).

## 9. Attachments silently dropped on retry/edit

- **Symptom:** Retrying, editing, or regenerating a turn that had images silently lost the images.
- **Root cause:** The composer's optimistic clear wiped the staged images before the resend used them.
- **Fix:** `send()` takes images explicitly; a ref survives the optimistic clear; Edit re-stages the original images as removable chips. Plus a pile of hardening: 20 MB cap, oversized-PNG downscaling, sha256 dedup, orphan-blob sweep, BOM/binary rejection in text ingestion.
- **Why it's good:** shows attention to the unglamorous edge cases of file handling.

## 10. Hot window sliced by array index instead of turn number

- **Symptom:** Occasionally the current user message would be dropped and an empty `messages` array sent — which Codex's bare `input` field 400s on (other providers tolerate it).
- **Root cause:** The "recent turns" window sliced by array *position*, but editing/deleting/retrying leaves gaps, so position ≠ turn.
- **Fix:** Filter the hot window by the persisted integer `turn` field, not array index.
- **Why it's good:** a correctness bug that only surfaces after message mutation and only 400s on one provider — the kind of thing you find by testing broadly.

## 11. Memory that never went stale — a fact and its contradiction, both fed to the model forever

- **Symptom:** Nothing crashed; it was a design review catch, not a stack trace. `GlobalMemory` (the `remember`-tool fact store) deduped exact/near-identical restatements, but a fact that *changed* — "Alex works at Google" → weeks later, "Alex joined Stripe" — is different text, so dedup doesn't catch it. Both stayed in the store and both got fed to the model on every future turn, with no recency signal to say which was current.
- **First thought:** "Just delete or overwrite the old one when a new fact looks similar."
- **Root cause (of *that* being wrong):** A flat list has no place to record *why* a fact stopped being true, and hard-overwriting a store whose whole value is "the right panel shows exactly what the model saw" breaks the trust/inspectability promise the first time someone asks "wait, why did it forget X?" Also naive similarity-based merging would be *global*, but facts here live on branches — a correction made on one fork shouldn't silently erase a fact a sibling fork never saw corrected.
- **Fix:** Typed the relationship instead of deleting: an `updates` edge flips the old fact to `status: "superseded"` (never deleted, still queryable/restorable as history) and an `isLatest` view — resolved against the querying branch's *ancestry*, the same parent-chain walk used for transcript reconstruction — decides what the model actually sees. Detection itself is asymmetric on purpose: hiding a fact needs two agreeing signals (a model verdict *and* a high similarity score), so a shaky signal downgrades to a non-destructive `extends` edge instead. A companion "derives" (inference) capability was built the same week and deliberately shipped **off by default** — it's the flashiest of the three relationship types and also the one likeliest to feed the model a guess dressed up as a fact.
- **Why it's a good story:** the bug never threw an exception — it's a *correctness* bug in the store whose entire pitch is reliability, caught by re-reading your own design rather than a crash, and the fix ("append-only log + typed edges," not "a graph that rewrites itself") is a real architectural choice with a stated trade-off, not just a patch.

---

## The meta-story

Notice a pattern: several of these were found by **actually using the product** ("what commands did you run?", the vanishing answer), and every one ends with a **regression test** and a **written changelog entry with the reasoning**. On a solo, months-long project, the real challenge is not forgetting *why* — so both `ONBOARDING.md` and `DESIGN.md` are dated decision-logs, and the hardest-won gotchas are documented specifically because violating them reintroduces fixed bugs. That discipline is itself part of the engineering.
