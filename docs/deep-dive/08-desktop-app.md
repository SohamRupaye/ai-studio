# 08 — The Desktop App (Electron, IPC & the chat:send flow)

> How it all comes together into a running app — the Electron process model, the secure IPC boundary, and the end-to-end "user sends a message" flow. This is the integration layer that wires every package together. Source: `apps/desktop` (~12k lines). The React UI itself is in `09-design-system.md`.

## Electron in three processes

| Process | File | Role |
|---|---|---|
| **Main** | `src/main/index.ts` (~1,600 lines) | Privileged Node process. Owns the SQLite `Store`, the provider `Router`, the knowledge graph, memory, the tool registry, MCP/skills, and **every IPC handler**. The only place with filesystem access. |
| **Preload** | `src/preload/index.ts` (~60 lines) | The *only* bridge. Exposes a single frozen `window.ipc` object via `contextBridge`. |
| **Renderer** | `src/renderer/**` | React 19 SPA. No Node, no `electron` import — it can only reach main through `window.ipc`. |

## Security posture (a strong, self-contained answer)

The window is created with `contextIsolation: true, nodeIntegration: false`. So the renderer runs in an isolated world and cannot touch `require`, `process`, or Node globals — **the preload bridge is the entire attack surface.** On top of that:

- **CSP** (`default-src 'self'; script-src 'self'`) — no remote script can load.
- **External navigation lockdown** — `setWindowOpenHandler` denies all `window.open` and routes real URLs to `shell.openExternal`, so the renderer can't spawn arbitrary Electron windows.
- **Path-traversal guard** — the `attachment:data` handler resolves a caller-supplied blob path but rejects anything not under `dataDir/blobs`, so a crafted `../` can't read arbitrary files.
- **Secret redaction at the boundary** — MCP OAuth tokens/headers are stripped before crossing to the renderer; it only sees booleans (`hasToken`, `hasOauthClient`). API keys likewise return presence maps, never values.

Honest caveats to have ready: `sandbox: false` is a deliberate trade-off (the preload needs `webUtils.getPathForFile` and CJS semantics; context isolation is still the primary guarantee). And `config.yaml` currently ships a real-looking key in the repo — I'd move that to env/keychain.

## The typed IPC boundary

The contract lives in `packages/event-bus` (see `03`), consumed by *both* preload and main so they can't drift. The preload exposes three generic methods:

- `invoke<C>(channel, payload)` → typed request/response over `ipcRenderer.invoke`.
- `on<C>(channel, handler)` → subscribe to a push channel, returns an unsubscribe function.
- `pathForFile(file)` → `webUtils.getPathForFile`. (An Electron ≥32 detail worth knowing: `File.path` was *removed*, so this preload-only API is the sanctioned way drag-drop gets an absolute path; it returns `""` for pasted/web-dragged bitmaps that have no backing file.)

A 10-line `window.d.ts` merges `Window.ipc` so the renderer gets full type inference on channel names and payloads without importing electron.

## The system prompt (`buildBaseSystem`)

The app-level system prompt is **rebuilt every turn** (so today's date is always current — the model is told to trust it over training data). It's deliberately *compact* because the default model is small and small models follow short prompts best. Labeled sections: identity ("conversations work like git… durable context accumulates per project"), `ENVIRONMENT` (date + OS), `HOW TO ACT` (do it now, never claim un-taken actions, stop after two failures), `MEMORY`, `RESPONSES` (markdown rules), and a `SKILLS` block listing only *enabled, described, non-slash-only* skills (progressive disclosure — bodies fetched on demand).

**Prompt layering** (outermost first): persona → `buildBaseSystem` → project instructions → the `systemContext` blocks from `prompt-engine`. A slash-invoked skill appends its full body as a binding `<invoked_skill>` block for that turn.

## `chat:send` end to end (THE money walkthrough)

When a user sends a message, the main process:

1. **Supersedes in-flight work.** There's *one* global agent loop for the whole window (not one per branch). If a turn is running, it's tagged "superseded" and aborted — it'll emit a "Cancelled — a newer message was sent" instead of hanging. (This is *why* every stream event carries a `branchId`.)
2. **Detects slash-skills** — a leading `/name` matching an installed skill; otherwise it's a normal message ("/etc/hosts is broken" passes through). A disabled skill errors without persisting.
3. **Capability gate** — if images are attached but the model has no vision, it refuses *before persisting* (with `turn: -1`) so the user can switch model and resend — never a half-committed turn.
4. **Persists the user message** and captures its `turn`, which is threaded through every later event so an error marks *this* message failed (not whichever is currently last).
5. **Builds the tiered payload** — `buildPayload` from `prompt-engine` (memory, ancestry, summaries, RAG retrieval, hot window, artifacts; see `05`).
6. **Captures context stats** and persists them to a `ctxstats:<branchId>` meta row. Crucially, these are captured **as a side effect here and never recomputed on demand** — a dry-run would spend real tokens (ancestry compression calls the model; retrieval runs embeddings). This is exactly what the right panel reads back.
7. **Picks the router** — `routerFor(orgId)` (the per-org cache, below).
8. **Wires subagent event forwarding** — `createRuntime(...)` with a callback that folds each subagent event into a persisted record using the *same shared reducer the renderer uses*, and forwards `{type: "subagent", branchId, …}` to the UI.
9. **Assembles messages for the model** — text-only for non-vision; for vision, blobs are read and base64-encoded into native image blocks (a missing blob degrades to a visible note). Native PDFs ride the current turn as document blocks.
10. **Streams the agent loop** — forwards `text`/`tool_start`/`tool_end` events (each tagged with `branchId`); on `done`, persists the assistant message with tool-call previews and subagent records, records cost, and sends the `done` event.
11. **Post-turn side effects** — classify the turn into the knowledge graph, capture memory, extract artifacts, schedule summarization (5s debounce), and auto-title the chat if it's unnamed (re-checking the flag after the async title call so a manual rename wins).

`chat:abort` is the explicit-Stop path — unlike supersede, it stays silent (the UI cleans up client-side). The distinction is carried on an `ExtendedAbortController.supersededByNewMessage` flag.

## Per-org router cache & the settings cascade

`routerFor(orgId)` maintains a `Map<orgId, router>`:
- No org keys → the global router.
- Org with its own keys → `Router.fromEnv(orgKeys)`, cached (keyed by a canonical serialization of the entries).
- **Invalidation:** `org:set-keys` drops that org's entry; `config:set` clears *all* org routers (they layer over base config, so a base change must rebuild them).

This is the concrete **global → org → project** cascade: base config from `config.yaml`, org overrides via its own router, project scope via its injected system prompt and the `orgId` that selects the router. Same pattern is the template for future scopes.

## The renderer's data layer (a mini react-query)

No external cache library. `hooks/use-ipc-data.ts` implements it in ~one file with a module-level `Set` of refetchers:
- **`useQuery(channel, payload)`** wraps `window.ipc.invoke`, tracks loading/error/data, serializes the payload to a stable key, guards against setState-after-unmount, and registers its refetch in the global set.
- **`useMutation(channel)`** invokes, then calls `invalidateQueries()` which fires *every* registered refetch — so creating/deleting a chat instantly refreshes the sidebar with no shared store.
- **Push-event listeners** (`models:refreshed`, `chat:titled`, `mcp:changed`, `skills:changed`) subscribe once and invalidate on the server-sent event.

Three React context providers wrap the app: `AuthProvider` (derives onboarding/auth state from whether any provider has models), `WorkspaceProvider` (active org/project, persisted, self-healing), `UiPrefsProvider` (sidebar/right-panel state).

## The chat page's streaming (where the frontend engineering is)

`chat-page.tsx` (~1,400 lines) is keyed by `branchId` so it *remounts* on branch switch — draft text and streaming state never bleed across branches. Two things worth explaining:

- **The optimistic bubble problem.** The `chat:send` IPC promise doesn't resolve until the *whole* turn finishes, so the user's own message would be invisible for the entire generation. Fix: render a pending bubble immediately and hide it the moment the real refetch lands (comparing against the last real turn to avoid a one-frame duplicate).
- **Frame-batched streaming** (a headline gotcha). Text deltas arrive as hundreds of IPC messages per second, each in its own task, each forcing a separate React render. Fix: buffer deltas and flush at most **once per `requestAnimationFrame`**. Counterintuitive selling point: *the stream reads smoother because it renders less often.* (Companion detail: the streaming message overrides `content-visibility` to `visible`, because Chromium otherwise defers painting in-place token mutations and the whole reply "pops in" at once.)

Message actions map to the git model: Edit/Retry call `message:edit(turn)` (which truncates everything after that turn) then resend; **Branch-from-here** calls `branch:create` with `forkAtIndex = turn`. Inherited rows (from ancestor branches) are read-only, with a "Forked here" marker dividing inherited ancestry from the branch's own turns.

## File & attachment handling (two pipelines)

- **Images** — staged into `data/blobs` as UUID files via **temp-write + atomic rename**. A 4 MB cap re-encodes/downscales PNG/JPEG to JPEG (providers reject oversized images, and the bytes ride *every* turn as base64). Magic-byte sniffing handles nameless pasted screenshots.
- **Documents** — `ingestion.ts` is deliberately **Electron-free so it's unit-testable**, with heavy libs lazy-imported. It classifies by extension (`text | pdf | docx | xlsx`, 20 MB cap): UTF-8/UTF-16 BOM-aware text (rejecting binaries); PDF via `pdf-parse` (importing the *lib file directly*, not the package index, which runs a debug harness that reads a bundled test PDF and crashes in a packaged app — a real gotcha); XLSX via SheetJS but only after a ZIP/CFB magic-byte check (SheetJS otherwise "parses" arbitrary bytes as CSV); DOCX via mammoth. Library errors are mapped to user-actionable messages.
- **Artifacts** — uploads parse to text, preserve the original blob for lossy formats, auto-select so the next turn sees them, and **sha256-dedup** so identical bytes on a branch re-select the existing artifact instead of duplicating context cost. Extracted and uploaded artifacts flow through the *same* selection machinery.
- **Orphan sweep** — because blobs are written before any DB row references them, a startup sweep deletes unreferenced blobs older than 24h (the age floor protects drafts still being composed).

## Config system

`config.yaml` lives in `app.getPath("userData")` — *not* `process.cwd()` (a hard-won fix: cwd is unpredictable for packaged Electron and previously caused saved keys to vanish on restart). It holds default model, API keys (env var wins over yaml), classifier settings, MCP servers, `disabled_models`, `disabled_skills`. `saveConfig` is a partial merge, and `config:set` **rebuilds the router, clears org routers, and refreshes models in the background — so new keys take effect with no restart.**

Nuance: `disabled_models` is filtered only from *selection menus*, not from routing — so a pinned branch on a hidden model keeps working. Both disabled lists use "disabled-list semantics" (a newly installed model/skill defaults to enabled).

## Likely drill-in questions

- **"How is the Electron app secured?"** Context isolation + node integration off (renderer can't reach Node), a single typed preload bridge as the only surface, CSP, external-nav lockdown, path-traversal guard on file reads, and secret redaction at the boundary.
- **"Why one global agent loop, not one per branch?"** Simplicity — but it means every stream event must self-identify with `branchId` so the renderer can filter, and there's explicit supersede logic when a new message arrives mid-turn.
- **"How does the UI stay in sync without Redux/react-query?"** A ~one-file mini-cache: mutations and server push events call `invalidateQueries()`, which fires every registered refetch.
- **"How do you make token-by-token streaming smooth?"** Batch deltas onto one rAF frame; memoize the markdown renderer; force `content-visibility: visible` on the streaming node.
