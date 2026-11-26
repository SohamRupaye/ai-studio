# 03 — Data Model & Persistence (the "Git" part)

> How context is stored and how branching/forking actually works. "How do you branch AI context?" is the single most common deep-dive question about this project. Source: `packages/database`, `packages/shared`, `packages/event-bus`.

## The hierarchy

**Organisation → Project → Space → Chat → Branch → Message**, plus side tables (Summary, Artifact, Cost, Memory).

- **Organisation** — groups projects, holds its own optional API keys.
- **Project** — a body of work; has a `system_prompt`, an icon, a `sort_order` (for drag-reorder).
- **Space** — a functional area (Design/Development/Business). Owns memories, artifacts, chats.
- **Chat** — a container. Has an `auto_name` flag (see auto-titling below).
- **Branch** — a line of conversation. **This is where the Git magic lives.**
- **Message** — a single turn, ordered by an integer `turn` per branch.

## The tech choices in one line each

- **SQLite via `better-sqlite3`** — single-file, local, synchronous (simpler code). `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`.
- **Raw parameterised SQL, no ORM** — Drizzle was removed (never wired to anything). One `Store` class (`store.ts`, ~1000 lines) with private `rowTo*` mappers converting snake_case rows → camelCase domain objects. Multi-statement mutations run inside `db.transaction(...)`.
- All the DDL is one `SCHEMA` template string executed on construction.

## How branching/forking works — the headline answer

Two columns on the `branches` table do all the work:

- **`parent_id`** — which branch this one forked from. (Deliberately *not* a declared SQL foreign key, so deletion can re-point children freely.)
- **`fork_at_index`** — the parent message index the fork branched off at.

A forked branch **stores only its own new messages.** The full context a model sees is **reconstructed lazily on demand** by walking the parent chain. That function is `getAncestryMessages` (`packages/prompt-engine/src/context.ts:40`):

```
walk parentId upward (depth-capped at 30 to guard cycles/overflow)
for each ancestor:
    inherited = forkAtIndex defined
        ? parentMessages.slice(0, forkAtIndex + 1)   // context UP TO the fork point
        : whole parent transcript
flatten oldest-first
```

So forking is **cheap** (you copy nothing; you store a pointer + an index) and **exact** (you inherit precisely the context that existed at the fork point, not more). This is literally `git branch` semantics applied to conversation.

**Two details that make this robust and worth highlighting:**

1. **What the user sees == what the model gets.** The `message:list` IPC uses the *same* ancestry walk to render the transcript, flagging inherited rows with `inherited: true`. So the right-panel context inspector isn't an approximation — it's the same code path that builds the prompt.
2. **Deleting a mid-chain branch re-parents its children to the grandparent** (`deleteBranch`): `UPDATE branches SET parent_id = <grandparent> WHERE parent_id = <deleted>`, then soft-delete. The ancestry walk stays intact — grandchildren just skip the tombstone.

**Invariant: every chat is born on a `main` trunk.** `createChat` always creates a `main` branch, and a migration backfills a trunk for any branchless chat on open. You can never land in an unusable chat with no branch — exactly like a fresh git repo has `main`.

**Forks inherit attached documents too.** `createBranch` copies the parent's `selected_artifacts` array — so a fork inherits not just the transcript but the pinned context documents. Same "git for context" principle.

## Messages: turn-based, not timestamp-based

Messages order by an integer `turn`, and the code is careful here:

- `addMessage` uses **`MAX(turn) + 1`, never `COUNT`** — so after you delete or undo turns, new turns don't collide with old ids.
- **Edit = truncate + resend.** `editMessage` deletes the message at `turn` *and everything after it*, then the edited text re-sends through the normal chat flow (picking the next free turn). Two rows never fight over one turn number.
- **Delete a pair** (`deleteMessagePair`) removes the user message and its paired assistant reply (only if the next row is actually an assistant turn).
- JSON columns (`tool_calls`, `images`) are parsed defensively — a corrupt row degrades to showing text without activity/images rather than throwing.

## Soft delete — "Git for context shouldn't destroy context"

Projects, spaces, chats, branches, and artifacts all have a `deleted_at` column; every read filters `WHERE deleted_at IS NULL`. Three deletion semantics, each paired with an `*Impact` method that powers the confirm dialog's "this will remove N branches, M artifacts…" copy:

| Action | Semantics |
|---|---|
| **Delete chat** | Soft cascade (its artifacts → branches → chat) in one transaction |
| **Delete space** | Soft cascade (artifacts → branches → chats → space); recreates a "General" space if you deleted the last one |
| **Delete project** | **The one irreversible HARD delete** — purges messages → summaries → costs → artifacts → branches → chats → spaces → project (soft-deleted rows included). UI gates it behind a typed challenge ("I understand, delete project") |
| **Delete organisation** | Hard, but refuses while any project remains |

## Migrations — additive, idempotent, version-less

The migrator (`migrate()`) runs `PRAGMA table_info(<table>)`, checks if a column exists, and `ALTER TABLE ADD COLUMN` if not. No version numbers — it's *convergent* (safe to run against any DB shape). Plus a few backfills: `sort_order` from `created_at`, orphan chats into a default space, and the "every chat has a trunk" invariant.

### The migration gotcha (great "subtle bug" story)

`SCHEMA` (all the `CREATE TABLE`/`CREATE INDEX`) runs **in full, first**, then `migrate()` runs the `ALTER TABLE ADD COLUMN`s. So if you put `CREATE INDEX ... ON chats(space_id)` in the `SCHEMA` block, then on a *pre-existing database* that index tries to build on a column that doesn't exist yet (it's only added later in `migrate()`) → "no such column: space_id" → the entire `Store` constructor throws → app won't open. **The rule: any index on a migration-added column must live inside `migrate()`, after its `ADD COLUMN`.** This was a real bug, fixed, and regression-tested.

## Two things stored *outside* SQLite (deliberately)

- **Layered memory** (`global_memory.ts`) is a **JSON file** (`data/global_memory.json`), not a table. Facts are scoped with a typed union: `global | project:<id> | chat:<id> | branch:<id>`. `forBranch` returns facts visible to a branch ordered by specificity (global → project → chat → branch). This is what gets injected into prompts as the memory block. (It's a file because scoping/merging is simpler as a small document than as relational rows, and it's small.) It's no longer just a flat list: each fact now carries a `type` (fact/preference/episode/derived), a `status` (active/superseded/expired/archived), and typed edges to other facts (`updates`/`extends`/`relates`/`derives`) — a branch-aware `isLatest` view so a contradicting fact supersedes the old one instead of both persisting forever. See `05-context-engine.md` for the full living-memory design.
- **File blobs** (uploaded images/PDFs/docs) live on disk under `data/blobs/<id>`; the DB row stores only a reference (`blob_path`, `content_sha256`, `byte_size`). Uploads are sha256-deduped; a startup sweep deletes orphan blobs older than 24h.

## The typed IPC contract (event-bus)

The entire Electron main↔renderer boundary is expressed as TypeScript types in one file (`event-bus/src/index.ts`) — the single source of truth. Two kinds of channel:

- **Invoke channels** (`IpcInvokeMap`) — request/response, ~90 of them, each a tuple `[Request, Response]`. E.g. `"project:list": [{orgId}, Project[]]`.
- **Push channels** (`IpcEventMap`) — one-way main → renderer: `chat:stream`, `models:refreshed`, `chat:titled`, `mcp:changed`, `skills:changed`, `window:fullscreen-changed`.

A generic `window.ipc.invoke<C>(channel, payload)` bridge makes every call statically typed — `window.ipc.invoke("project:list", {orgId})` is known to return `Promise<Project[]>` at compile time, and a wrong payload fails to compile. Clean, and it means the frontend and backend can't drift.

**`AgentStreamEvent`** (the `chat:stream` payload) is worth knowing: every variant carries a `branchId`. Why? Main runs one agent turn at a time, but the user might navigate to a *different* branch before it finishes — so each streamed event self-identifies rather than assuming "whichever page is open." The subagent variant folds in the subagent event stream (see the agent doc).

## Cost tracking

A `costs` table records per-turn `input_tokens`/`output_tokens`/`cost_usd` per branch. Project-level spend rolls up with a `costs → branches → chats` join filtered by `project_id`, so a project's total cost includes all its branches and forks.

## If they drill in: "why not Postgres / a real server DB?"

Because the product is **local-first** — your context and keys live on your machine, no server, no account required to start. SQLite ships *inside* the app as a single file. When multi-user lands, it's an *async push/pull* model (Git-style), not a shared live database — so you still don't need a central authority for the core loop. (See `10-key-decisions.md`.)
