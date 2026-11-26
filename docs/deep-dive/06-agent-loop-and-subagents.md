# 06 — The Agent Loop & Multi-Agent Delegation

> How the AI actually *does things* — the tool-call loop, the guardrails, and how one agent spins up others. Source: `packages/ai-core` (`agent.ts`, `runtime.ts`, `orchestrator.ts`, `classifier.ts`, `costs.ts`, `artifacts.ts`) + the subagent tools in `packages/tools-runtime`.

## The agent loop (`agent.ts`)

At its core it's the standard "agentic loop": stream from the model, if it asks for tools, run them, feed results back, repeat until it stops or hits a cap. The `Agent.run()` method is an **async generator** that yields stream events (`text`, `tool_start`, `tool_end`, `done`).

The loop, per iteration:
1. Stream from the router. Accumulate text, buffer any tool calls, forward streaming events, feed usage to the cost tracker.
2. **No tool calls** → the model wants to stop. Run the response validator (below). If it flags a problem and iterations remain, push the rejected draft + a correction and continue; otherwise finalize and break.
3. **Tool calls present** → append the assistant message, execute each tool sequentially (emit `tool_start`, run it, record success, emit `tool_end`, push the `tool_result`), then loop so the model can react to results.
4. Stop on natural completion or `maxIterations` (default 10). Always end with one `done` event carrying the `AgentResult` (`{text, iterations, toolCalls, cost}`).

### One subtle, load-bearing detail: text accumulates across iterations

The final reply is **everything the model wrote across all iterations, joined** — not just the last chunk. This fixes a real bug: a model writes a long answer, *then* calls a tool (e.g. `remember`), *then* adds a short follow-up. An earlier "overwrite per iteration" design dropped the long answer and persisted only "Done — I've stored that." Now the parts are joined with `\n\n`. (Good "subtle bug I fixed" story.)

### The "act, don't ask" guard (`validateResponse`)

Two independent checks that catch model misbehavior:

1. **Deflection guard.** Fires *only* when the user made an action request (verbs like fix/change/implement) AND the response is **short (< 400 chars)** AND it matches a confirmation pattern ("would you like me to…", "shall I proceed"). Then it injects `"[SYSTEM] You asked for confirmation instead of acting. Execute the change NOW."` — the < 400-char gate is itself a fix: a *full* answer that ends with a friendly "If you want, I can tailor this…" is a complete answer plus an offer, **not** a deflection, and flagging it destroyed the whole reply. A real deflection is a question *instead of* an answer; a long answer with a closing offer isn't.
2. **Fabricated-action guard.** If the text *claims* a mutation ("I changed/updated/fixed…", "done ✅") but **no write tool was actually called** (`write_file`, `edit_file`, `patch`, `bash`), it injects `"[SYSTEM] You claimed changes but did NOT call write tools. This is a hallucination."` This catches the classic LLM failure of narrating work it never did.

Both are careful not to hijack normal Q&A — an informational question ("what tools do you have?") isn't an action request, so nothing fires.

## The runtime & dependency injection (`runtime.ts`)

`createRuntime(router, registry, defaultModel, onSubagentEvent?)` returns `{ runTask }` and — crucially — **injects `runTask` into the tools-runtime package** via `setSubagentDependencies`.

**Why injection?** `tools-runtime` can't import `ai-core` (that would be a circular dependency), but the `subagent`/`delegate` tools *live* in tools-runtime and need to run a full agent. So ai-core pushes the runner in at startup. This is worth telling as a bug story: there used to be a **private duplicate** of the injection point inside ai-core that nothing read — so every delegation silently returned "dependencies not initialized" while the tools stayed visible to every model. The fix unified on the tools-runtime export. `createRuntime` is called **per chat turn**, so subagents inherit the current branch's org-scoped router and model.

### `runTask` — running a subagent

- Builds a **restricted sub-registry**: copies every tool *except* the delegation tools themselves (`subagent`, `delegate`, …) so there's no infinite recursion, optionally narrowed to an allowlist.
- Runs an `Agent` (maxIterations 15), translating its events into `SubagentStreamEvent`s (`text`/`tool`/`tool_end`/`done`).
- **Per-agent lifecycle events** — emits `start` (task + model), then live `text`/`tool` events, then `done`/`failed`. Observer errors are swallowed so a buggy UI listener can't kill a run.
- **Timeouts** — 5 min default (overridable). An `AbortController` + `setTimeout` is passed into the agent (and thus the provider). Because *some providers ignore the abort signal*, there's an event-loop backstop: it checks `signal.aborted` on every streamed event and throws "Timed out" — proven against a provider that streams forever and ignores abort.
- **Model-hallucination fallback** — the delegating model routinely invents model ids ("current", "gpt-4.1-mini") despite the schema saying to omit them. If the error matches `/No provider for model/` *and* an override was given *and* a valid default exists, it re-runs on the chat's default model and prefixes the result with a visible `(Requested model "X" isn't available here — ran on "Y".)`. Scoped narrowly to that one error so real errors (rate limits) still surface. It's a *run-level catch*, deliberately not a pre-check, so normal prefix-routing and live model-list refresh keep working.

## subagent vs delegate

Two delegation modes, both in `tools-runtime/src/tools/subagent.ts`:

| | **`subagent`** | **`delegate`** |
|---|---|---|
| Mode | Parallel, **blocking** the turn | **Background**, fire-and-forget |
| Concurrency | Up to 4 in parallel (`Promise.allSettled`) | Up to 4 running jobs |
| Timeout | 5 min each | 10 min (it's the long path) |
| Returns | A digest of all agents' results | Immediately; poll with `delegate_result` / `delegate_list` |
| Use | "Fan out these 4 independent tasks now" | "Go work on this in the background while we keep talking" |

`Promise.allSettled` means one subagent failing doesn't sink the batch — failures render as `Failed: <reason>` in the digest. All agents in a batch share one `runId` with distinct `agentId`s.

### The subagent transcript reducer (one reducer, two consumers)

Streamed subagent events fold into a `SubagentRunRecord` (`{agentId, task, model, status, steps[], result, durationMs}`) via **`applySubagentEvent`, a pure reducer in `@squirl/shared`.** The clever part: **the same reducer runs in the main process (for persistence) AND in the renderer (for the live drawer)**, so the live view and the saved record *cannot drift* — they're the same fold over the same event stream. Consecutive text deltas merge into one step; a tool event splits a segment; `tool_end` back-fills the most recent still-open matching tool call. Bounds (300 steps, 12k chars/step, 16k result cap) prevent a chatty agent from bloating the DB row. It even tolerates `start` firing twice (the model-fallback re-announces the actual model).

## The classifier (`classifier.ts`)

Covered in depth in `05-context-engine.md` — but in the agent-loop context, the key point: **after every turn, a background classifier distills the conversation into knowledge-graph nodes.** Two-tier (API model, falling back to a local zero-shot model), with an enrich queue that re-upgrades coarse local classifications once the API recovers, exponential backoff, and crash-durable disk queues. This is the write path that makes context compound over time.

## Cost tracking (`costs.ts`)

A `CostTracker` normalizes both token-naming conventions (`input_tokens`/`prompt_tokens`), looks up a per-model `[input, output]` $/million-token rate via **substring match** (so `claude-sonnet-4` matches `claude-sonnet`), and computes cost. Unknown models get a default rate. Worked example: sonnet at [3, 15] with 1000 in / 500 out = `(1000·3 + 500·15) / 1e6 = $0.0105`. (Honest limit: a model whose id doesn't contain a known prefix gets mis-priced at the default rate.)

## Artifact extraction (`artifacts.ts`)

After an assistant reply, a regex scan detects "artifact-worthy" content — fenced code blocks ≥200 chars, or markdown H1 sections titled PRD/Architecture/Plan/Research — and persists them as artifacts (with a derived title from a `// file:` comment or a `function`/`class` line). This is how a conversation's *outputs* become first-class project objects. (It carefully resets the global-regex `lastIndex` before each scan — a classic stateful-regex footgun.)

## The orchestrator (`orchestrator.ts`)

`runWithContext` is the documented single entry point gluing **context → agent** for one turn: resolve branch + model → expand `@file` references → save the user message → `buildPayload` (the tiered context) → prune large tool outputs from history → assemble the system prompt → run the agent → persist the reply and record cost. (The live desktop app has a richer bespoke version of this in `main/index.ts`, but it mirrors these steps.)

## Likely drill-in questions

- **"How do you stop an agent from looping forever?"** A hard `maxIterations` cap (10 top-level, 15 for subagents) plus wall-clock timeouts with an abort backstop that works even if the provider ignores the signal.
- **"How do you prevent infinite subagent recursion?"** The sub-registry a subagent gets excludes the delegation tools entirely.
- **"How do you catch the model lying about doing work?"** The fabricated-action guard: claims of mutation with no write-tool call get rejected and corrected.
- **"How does a subagent inherit the right model/keys?"** `createRuntime` runs per turn and injects the current branch's org-scoped router + model, so delegations run on the same resolved provider config as the parent.
