# plan.md — Boop steals (five features)

Feature tracker (started + landed 2026-07-18). Read `DESIGN.md` for the design system, `ONBOARDING.md` for project state, `debt.md` for what was deliberately skipped. The prior contents of this file (the tool-call-transparency tracker) shipped and now live in the ONBOARDING + DESIGN changelogs.

## Where this came from

We evaluated [raroque/boop-agent](https://github.com/raroque/boop-agent) (a single-user iMessage agent) and lifted the patterns Squirl was missing. Decisions taken up front: **inline pause-card** approval UX (not boop's drafts system), gate = **MCP writes + bash warn-patterns** (local file/git tools stay ungated — checkpoints cover them), memory hygiene = **dedup only** (no decay — "git for context never destroys context"). Item #6 (per-task subagent tool scoping) already existed — documented, not rebuilt.

Also evaluated and parked this session (see debt.md): **Composio** (rejected as an MCP replacement — needs a backend to hold the API key we don't have) and the **Claude Agent SDK subscription engine** ("Sign in with Claude" — real but a permanent two-loop tax; parked with a post-launch trigger).

## Landed (all committed, each its own commit)

- [x] **A — Tool approval gating.** `ToolVetoError` + veto in `registry.execute`; `main/approvals.ts` (MCP write-verb policy, `PermissionStore` reuse, 5-min timeout); `onBeforeExecute` hook + revived `setBashConfirmCallback`; `chat:approval-decision` IPC + `approval_request`/`approval_resolved` events; `chat/approval-card.tsx`; Settings → General permissions list. Tests: registry veto (tools-runtime), vetoed-call-continues-loop (ai-core).
- [x] **D — Delegated-agent orphan fix.** `Store.updateMessageToolCalls` + `messagesWithRunningAgents`; startup `sweepOrphanAgentRuns`; late-settle writeback in `chat.ts`. Test: store round-trip incl. the LIKE-prefilter decoy.
- [x] **E — Memory dedup-on-add.** `GlobalMemory.add` dedup (normalized-exact + Jaccard ≥ 0.85, same-scope) + `addWithStatus`; `remember` tool reports "Already remembered". Tests: 5 dedup cases incl. reload-from-disk.
- [x] **B — Automations.** `automations` table + repo; `executeTurn` extracted from `chat:send` (private controller for scheduled runs); `main/scheduler.ts` (croner); `create/list/toggle/delete_automation` tools; `automation:*` IPC + `automations:changed`; `settings/automations.tsx`. Test: repo CRUD + run-record round-trip.
- [x] **C — Local browser.** `tools/browser.ts` (Patchright, optional dep, opt-in, aria-snapshot-first); `browserToolEnabled` config; live reconcile on `config:set`; `browser_fill` text redaction; Settings → General toggle.
- [x] **Docs.** ONBOARDING + DESIGN changelog entries; this tracker; debt.md parked entries.

## Verify (user restarts `yarn dev` first — main process + packages changed)

1. **Approval**: connect an MCP server with a write tool (or `bash rm …`) → ask the agent to use it → card appears, turn pauses. Deny ⇒ model continues with "User declined". Approve ⇒ runs. "Always allow" ⇒ next call skips the card; rule shows in Settings → General, removable. Delegate a task that uses an MCP write ⇒ card still appears (subagent coverage).
2. **Orphans**: start a `delegate` job, quit mid-run, relaunch ⇒ persisted row reads "Interrupted — app was restarted", not a spinner. Let a delegate finish after its turn ⇒ reopen the chat, row shows done + result.
3. **Dedup**: tell the agent the same fact twice ⇒ one memory in the right panel; `remember` says it already exists.
4. **Automations**: "every minute, say hi" (test cadence) ⇒ a turn appends each minute; toggle off in Settings → Automations stops it; relaunch ⇒ schedule resumes; overdue-while-closed fires once.
5. **Browser**: enable in Settings → ask the agent to open a login-required site ⇒ a headed Chrome opens with a persistent profile; `browser_fill` args show `•••` in the tool row detail.

## Known limits (accepted)

- Automations only fire while the app is running (local-first — stated in the UI).
- Approval policy is name-heuristic on MCP tools (no per-tool annotations read yet); native writes rely on checkpoints, not approval.
- Browser tools are string-result only (no screenshots) and have no login-handoff prompt yet — see debt.md.

## Closeout

- [ ] Clear this file when the user has run the verify checklist and accepted.
