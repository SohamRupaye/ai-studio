# 07 — Tools, MCP, LSP & Skills

> The agent's "hands" — how it runs commands, talks to external services, understands code, and loads reusable capabilities. Source: `packages/tools-runtime` (the biggest package, ~9,700 lines). This is where "how does the MCP OAuth flow work?" and "how are tools executed?" get answered.

## The tool registry (`registry.ts`)

Not just a `Map` — a production-grade `ToolRegistry` (extends `EventEmitter`). Every tool call runs a **6-stage lifecycle**:

1. **Schema validation** — a hand-rolled JSON-Schema-lite check (required fields, primitive types, enums). On failure it throws an error whose message tells the *model* to rewrite its input.
2. **Before-hooks** — plugins can rewrite args.
3. **Execute.**
4. **Truncation** — caps output at ~80k chars with head/tail/middle strategies.
5. **After-hooks** — plugins can rewrite results.
6. **Observability** — records a span, emits `tool_executed`/`tool_error` with durations.

Key design choice: **errors never throw out of `execute`.** A failing tool call becomes model-readable text (`{output, metadata: {error: true}}`) so a bad call gets fed back to the model to fix, rather than crashing the whole turn.

There's a neat backward-compat seam: tools can be written against a simple legacy shape (`{name, handler}` returning a string) or the richer canonical shape; the registry normalizes both, wrapping a string return into a structured result.

## The ~50 built-in tools (`defaults.ts`)

Registered by hand, grouped by category:

- **File ops** — `read_file`, `write_file` (emits a diff summary), `edit_file` (first-occurrence replace + diff preview), `list_directory`, `search_files`.
- **Search** — `grep_search` (ripgrep-style, own glob→regex, context lines, binary skip), `glob_files`.
- **Shell** — `bash`, with a **two-tier safety model**: `BLOCKED_PATTERNS` hard-refuse dangerous commands (`rm -rf /`, `sudo`, `curl … | sh`), `WARN_PATTERNS` route risky ones (`git push`, `DROP TABLE`) through an injectable confirmation callback.
- **Git** — status/diff/log/commit/add.
- **Patch** — `apply_patch`, a unified-diff applier with hunk-context verification.
- **Code intelligence** — `find_definition`, `find_references`, `find_callers`, `project_symbols` (LSP-backed), plus `code_context` symbol extraction.
- **Testing** — `run_tests` (auto-detects vitest/jest/pytest/cargo/go), `run_failing_tests`, `test_coverage`.
- **Packages** — list/add/remove/outdated dependencies.
- **Terminal** — long-lived background PTY sessions (`terminal_start/read/send/kill`) with output buffering and "wait for string."
- **HTTP / Web** — `http_request`, `web_search` (Exa.ai → Parallel.ai → DuckDuckGo fallback chain), `web_fetch`.
- **Knowledge base** — `kb_write/read/search` (persists per-project JSON).
- **Checkpoint** — `checkpoint_create/rollback/diff` — file-snapshot undo (another "git for context" primitive).
- **Agent meta** — `think`, `tool_search`, `tool_list`, and the subagent tools.

**Progressive tool disclosure** is worth calling out: `tool_search` and `tool_list` let the model *discover* tools that aren't in its base system prompt — a keyword/relevance search over the registry. So the base prompt stays small but the model can reach any of the 50+ tools on demand.

**Custom tools** can be dropped into a `tools/` directory as `.ts`/`.js` files and are hot-reloaded (debounced `fs.watch`); any export with a `description` string and an `execute` function becomes a tool.

## MCP — Model Context Protocol (`mcp/`)

MCP is the open standard for connecting AI to external services (Notion, GitHub, Linear, Slack, Google Workspace, …). This is the most sophisticated part of the codebase.

### Three transports, three framings

- **stdio** — spawn a child process, JSON-RPC newline-delimited over stdin/stdout.
- **SSE** — server-sent events over `fetch`.
- **Streamable HTTP** (the modern transport) — no separate handshake; the `initialize` POST *is* the connectivity + auth probe.

The **Streamable HTTP** framing is the trickiest part to get right:
- Every POST advertises `Accept: application/json, text/event-stream` — the response can come back as either plain JSON *or* an SSE-framed stream.
- The `Mcp-Session-Id` from `initialize` is captured and echoed on every subsequent request; the negotiated protocol version is echoed too.
- When the response is SSE-framed, the reader **skips interleaved server notifications** (routing them to the normal handler) until it finds the response whose JSON-RPC `id` matches its request. Notifications legitimately come back as empty 202s.

Tools from different servers are **namespaced** (`server_toolname`) so they can't collide, and an `MCPManager` connects many servers in parallel and routes calls to the owning client. Each MCP tool is wrapped as a normal registry tool.

### The OAuth 2.1 flow — the full answer

This is fully **spec-driven, not a hardcoded per-provider table** — which is *why* it works against Notion/Linear/GitHub/Slack/Google/Asana/Atlassian without provider-specific code. Walk it like this:

1. **Discovery.** From a 401's `WWW-Authenticate` header, follow **RFC 9728** protected-resource metadata to find the authorization server, canonical resource id, and supported scopes; then **RFC 8414 / OIDC** metadata to get the authorize/token/registration endpoints (with a last-resort fallback that synthesizes `/authorize`, `/token`, `/register` on the issuer origin).
2. **Loopback callback server.** Bind a one-shot local HTTP server on `127.0.0.1:19876` (walking up ports if busy). Redirect URI = `http://127.0.0.1:<port>/callback`.
3. **Dynamic Client Registration (RFC 7591).** If no client id is configured, register as a **public client** (`token_endpoint_auth_method: none`, PKCE). Registrations are cached and reused. If registration is gated (e.g. **Figma** allowlists apps → 403), it surfaces a "connect with an access token instead" hint.
4. **PKCE (S256).** Random state + verifier; `challenge = base64url(sha256(verifier))`.
5. **Authorize URL** with `resource` (RFC 8707 resource indicator) and scope. One provider quirk: for Google hosts it adds `access_type=offline` so web-type clients actually issue refresh tokens.
6. **Callback → code exchange.** Validate state (mismatch → reject as possible forgery), exchange the code + verifier for tokens *before* rendering the browser success page (so the tab reflects the real outcome), then force-close keep-alive sockets so the port frees immediately. 5-minute flow timeout.
7. **Silent refresh.** On a later 401 with a stored refresh token, do one silent refresh + retry before surfacing "needs auth."

**Token storage** is a `0o600` file (`~/.ai-studio/mcp-auth.json`) keyed by server, and it refuses to return a token unless the stored server URL matches exactly (prevents token reuse across URL changes). One shared auth instance is threaded through the manager and all clients so writes are immediately visible (a caching-staleness bug that was fixed by construction).

**PAT fallback.** For services with no dynamic registration (GitHub, Slack), the user can paste a **personal access token**; it's stored as an `Authorization: Bearer` header and wins over stored OAuth. This is the officially supported path for GitHub.

> **Important honesty note:** the "presets" (Notion, Linear, GitHub, Slack, Google Workspace) are a *UI curated list* — the runtime OAuth code is fully generic. And a handful of presets (GitHub/Slack/Figma/Google) still need a real OAuth app registered with each provider before zero-setup quick-connect works; the *code path* is done and tested, the remaining work is provider-console admin (tracked in `context/debt.md`).

## LSP — Language Server Protocol (`lsp/`)

The same idea as MCP but for *code intelligence* — this is what powers `find_definition`, `find_references`, hover, rename, diagnostics.

- **JSON-RPC over stdio with `Content-Length` framing** (the LSP wire format — different from MCP's newline framing; the code hand-parses both).
- **37 language servers** cataloged (typescript, pyright, rust-analyzer, gopls, clangd, …), each with file extensions, launch command, root markers, and an optional `install()`.
- **Lazy spawning** keyed by `serverId:root`, with in-flight-spawn dedup and a "broken" set to avoid re-spawning failures. **Auto-install on `ENOENT`** — if the server binary is missing, it runs the install command (e.g. `npm i -g typescript-language-server`) and retries once.
- **Diagnostics are dual-sourced** — it merges *push* diagnostics (server-initiated) and *pull* diagnostics (client-requested), then de-dupes. A nice robustness detail.

## Skills (`skills/`)

Skills are reusable, model- or user-invokable capabilities packaged as a folder with a **`SKILL.md`** (YAML frontmatter: `name`, `description`, markdown body) — the **ecosystem-standard format** (Claude Code style), so skills from the community just work.

- **Two invocation paths, same skill:**
  - **Model-invoked** — enabled skills' name+description go into the system prompt as an `<available_skills>` block, and a `skill` tool loads the full body on demand (progressive disclosure — bodies are never all preloaded).
  - **User-invoked** — typing `/name` in the composer injects the skill's body as a binding `<invoked_skill>` block. The persisted message keeps the raw `/name` text (the transcript *is* the record; forks inherit it).
- **`disable-model-invocation: true`** in frontmatter makes a skill slash-only (excluded from the model's list). Honors the Claude Code convention.
- **Install from GitHub** — paste a repo URL; it resolves the default branch, walks the git tree, finds every `SKILL.md` folder, and validates each *at discovery time* so the picker can't show one skill and install another. Caps (50 skills, 100 files, 5 MB/file) and cleanup-on-failure.
- **Security: path-traversal guards everywhere** — skill names must match a strict pattern (no `..`, no slashes, no leading dots — they double as directory names *and* slash commands); catalogue file lists reject absolute/`..` paths; `remove()` refuses to delete anything outside the managed dir.
- Enable/disable lives in `config.yaml` (`disabled_skills`), and a recursive `fs.watch` (debounced) reloads on external edits.

## The standout engineering practice: fixture-based testing

Worth raising proactively. The MCP and LSP clients are tested against **real local fake servers, not mocks.** The MCP OAuth test stands up a real HTTP server implementing RFC 9728 / 8414 / 7591 and a token endpoint that *actually recomputes the PKCE challenge and rejects mismatches* — and the test "plays the browser" by fetching the loopback callback. The Streamable-HTTP test returns SSE-framed responses with an interleaved notification to prove the client skips to the right response id. This is why the OAuth flow could be trusted enough to ship — the tests exercise real socket and stream behavior, not my assumptions about the protocol.

## Two honesty notes (so it's not over-claimed)

- **`code_context` claims tree-sitter but falls back to a hand-written brace-counting/regex symbol extractor** — the tree-sitter WASM is stubbed for portability. Worth knowing so it doesn't get over-claimed.
- **`AgentSessionService`** (an HTTP+SSE API for IDE integration) is a *bespoke* protocol, explicitly **not** ACP-compliant — it was renamed off the ACP name precisely to avoid implying interop it doesn't have. Currently unwired.
