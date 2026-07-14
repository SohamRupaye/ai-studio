# AI Studio — Project Status Tracker

> Last updated: 2026-06-08

## Vision

AI Studio is a model-agnostic organizational intelligence layer — like Git for AI-native work. Context is the primary object, not chat. The product accumulates knowledge, decisions, reasoning, and artifacts so teams never re-explain context to AI.

---

## Architecture

```
@squirl/shared          → Type definitions (Message, Branch, Org, Project, Chat)
@squirl/tokenizer       → Token counting + model context limits
@squirl/event-bus       → Typed IPC contracts (40+ channels)
@squirl/database        → SQLite store (users, orgs, projects, chats, branches, messages, artifacts, costs)
@squirl/graph-engine    → SQLite-backed knowledge graph with local MiniLM-L6 embeddings
@squirl/providers       → Anthropic, OpenAI, Google, CodexOAuth + Router with retry/fallback
@squirl/context-engine  → RAG retrieval with MMR reranking, cross-branch knowledge sharing
@squirl/tools-runtime   → 50+ tools, MCP client, LSP client, Skills system
@squirl/prompt-engine   → Tiered context builder + progressive summarization + branch diff
@squirl/ai-core         → Agent loop, classifier, cost tracker, artifact extractor
@squirl/ui              → React hooks (minimal — UI not yet built)
@squirl/desktop         → Electron app (main process + basic renderer)
```

---

## Backend Status

### ✅ Complete

| Feature | Package | Notes |
|---------|---------|-------|
| Multi-provider BYOK | `providers` | Anthropic, OpenAI, Google, CodexOAuth (zero-config GPT-5 via PKCE) |
| Retry/fallback routing | `providers` | Exponential backoff on 429/5xx/network errors |
| Config validation + hot reload | `providers` | YAML config with `watchConfig()` |
| OAuth token refresh mutex | `providers` | Prevents race condition on concurrent calls |
| Stream JSON parsing safety | `providers` | try/catch on all SSE parsers |
| SQLite persistence | `database` | WAL mode, indexed, proper transactions |
| Org → Project → Chat → Branch hierarchy | `database` | Full CRUD with soft delete |
| User/team model (sync-ready) | `database` | users, team_members tables, updated_at columns |
| Artifacts table (versioned) | `database` | Type, title, content, version, branch/project scoped |
| Cost tracking (persisted) | `database` | Per-message recording, per-branch and per-project aggregation |
| Full UUIDs | `database` | No collision risk |
| Soft delete + child reassignment | `database` | Branches never truly lost |
| Turn number correctness | `database` | MAX(turn)+1, not COUNT(*) |
| Scoped memory (global/project/chat/branch) | `database` | Hierarchical fact layering |
| Knowledge graph (SQLite-backed) | `graph-engine` | Embeddings as BLOBs, indexed edges, concurrent-safe |
| Local embeddings | `graph-engine` | Xenova/all-MiniLM-L6-v2 (384-dim) |
| Cross-branch RAG retrieval | `context-engine` | MMR reranking, locality boost, no branch isolation |
| Tiered context builder | `prompt-engine` | Ancestry + summaries + RAG + pins + memory → system prompt |
| Progressive summarization | `prompt-engine` | Semantic chunking → summarize → meta-collapse |
| Iterative ancestry traversal | `prompt-engine` | 30-depth cap, no stack overflow |
| Branch comparison/diff | `prompt-engine` | Finds unique and conflicting decisions between branches |
| Agent loop with self-correction | `ai-core` | Validates responses, forces tool use, max 10 iterations |
| Cooperative yielding | `ai-core` | setImmediate between tool calls to keep UI responsive |
| Structured knowledge extraction | `ai-core` | Classifier extracts decisions, constraints, artifacts, relationships |
| Artifact auto-extraction | `ai-core` | Detects code, PRDs, plans, architecture, research from agent output |
| Node counter persistence | `ai-core` | No ID collisions on restart |
| 50+ tools | `tools-runtime` | File, bash, git, web, code intel, testing, packages, terminal, etc. |
| MCP client | `tools-runtime` | JSON-RPC 2.0 stdio transport, auto-registers tools |
| LSP client | `tools-runtime` | Definition, references, hover, diagnostics, rename |
| Skills system | `tools-runtime` | Markdown-defined reusable workflows |
| Subagent delegation | `tools-runtime` | Parallel (up to 4) + background fire-and-forget |
| Typed IPC (40+ channels) | `event-bus` | Org/project/chat/branch/message/artifact/memory/user/costs/models/config |
| Singleton tool registry | `desktop` | MCP tools persist across messages |
| Full wiring | `desktop` | buildPayload, classifyAndIndex, extractArtifacts, summarization, costs all connected |

### 🟡 Backend — Not Blocking but Could Improve Later

| Item | Priority | Notes |
|------|----------|-------|
| ANN index for graph queries | Low | Brute-force cosine is fine up to ~2-3K nodes |
| True worker thread for agent | Low | Cooperative yielding works; true isolation is better for heavy tool chains |
| Typed graph edges (supersedes/contradicts) | Medium | Metadata is captured but edges are similarity-only |
| Event bus for inter-subsystem reactivity | Medium | Classifier → UI notifications, summarization → graph |
| Sync server | Later | Schema is sync-ready (updated_at, user IDs). Server comes after MVP |
| Provider quality scoring / cost-aware routing | Later | Needs usage data accumulation first |
| Batch embedding in summarizer | Low | Sequential is fine for typical workloads |
| Graph partitioning by project | Medium | Single graph works for now; partition at scale |

---

## Frontend Status

### ❌ Not Started — Needs Full Implementation

#### Layout (3-panel)

- [ ] Left sidebar — workspace tree
  - [ ] Organisation selector
  - [ ] Project list (collapsible)
  - [ ] Chat list per project (collapsible)
  - [ ] Branch tree per chat (git-like hierarchy, not flat list)
  - [ ] Memories section
  - [ ] Artifacts section
  - [ ] Search (Cmd+K)
  - [ ] Project graph link
  - [ ] Project settings link
- [ ] Center — chat area
  - [ ] Message stream (markdown + code highlighting)
  - [ ] Tool call visualization (collapsible)
  - [ ] Streaming text with cursor indicator
  - [ ] Chat breadcrumb (`Chat name > Branch`)
  - [ ] Input bar with:
    - [ ] `@ context` button (attach context/files)
    - [ ] `⑂ fork` button (fork from current point)
    - [ ] Model selector dropdown
    - [ ] Send/Stop button
  - [ ] Fork-from-message action on each message
- [ ] Right panel — context/memory/artifacts/usage
  - [ ] Context panel (active pins, retrieved knowledge)
  - [ ] Memories panel (scoped facts — add/remove/list)
  - [ ] Artifacts panel (list with checkboxes to include in context)
  - [ ] Usage panel (cost per branch/project, token counts)

#### Screens / Views

- [ ] Chat view (main)
- [ ] Settings page (API keys, model defaults, MCP servers)
- [ ] Project graph visualization (SVG force-directed from graph-engine)
- [ ] Branch comparison view (side-by-side diff of decisions)
- [ ] Artifact detail view (versioned content with edit)
- [ ] Onboarding / first-run (user name, API key setup)

#### Component Library

- [ ] Choose and setup design system (shadcn/ui + Tailwind recommended)
- [ ] Theme system (light/dark)
- [ ] Typography scale
- [ ] Shared components: Button, Input, Modal, Dropdown, Tree, Panel, Tabs

#### Data Flow

- [ ] Wire `branch:switch` IPC on sidebar click
- [ ] Load message history on branch switch (`message:list`)
- [ ] Wire model selector to `branch:create` with model param
- [ ] Wire fork button to `branch:create` with parentId + forkAtIndex
- [ ] Display cost from `done` event
- [ ] Wire right panel to `memory:list/add/remove`, `artifact:list/get`
- [ ] Wire org/project/chat navigation to respective IPC channels
- [ ] Wire settings to `config:set`
- [ ] Wire user setup to `user:set`

#### Electron App

- [ ] React Router (or similar) for page navigation
- [ ] Window controls (close/minimize/maximize)
- [ ] Keyboard shortcuts (Cmd+K search, Cmd+N new chat, Cmd+B new branch)
- [ ] Drag-and-drop file attachment
- [ ] System tray / menu bar integration
- [ ] Auto-update (electron-updater)
- [ ] App icon + splash screen

---

## IPC Channels Available for Frontend

```typescript
// Organisations
"org:list"          → Organisation[]
"org:create"        → Organisation

// Projects
"project:list"      → Project[]
"project:create"    → Project

// Chats
"chat:list"         → Chat[]
"chat:create"       → Chat

// Branches
"branch:list"       → Branch[]
"branch:create"     → Branch
"branch:delete"     → boolean
"branch:switch"     → void
"branch:rename"     → void
"branch:pin-add"    → void
"branch:pin-remove" → boolean
"branch:compare"    → BranchDiff

// Messages
"message:list"      → Array<{role, content, turn}>
"message:undo"      → number

// Chat
"chat:send"         → void (streams via chat:stream event)
"chat:abort"        → void

// Artifacts
"artifact:list"     → Array<{id, type, title, version}>
"artifact:get"      → {id, type, title, content, version}
"artifact:update"   → void

// Memory
"memory:list"       → MemoryFact[]
"memory:add"        → MemoryFact
"memory:remove"     → boolean

// User
"user:get"          → {id, name} | null
"user:set"          → {id, name}

// Models
"models:list"       → Record<string, string[]>

// Config
"config:get"        → Record<string, unknown>
"config:set"        → void

// Costs
"costs:branch"      → Array<{model, inputTokens, outputTokens, costUsd, timestamp}>
"costs:project"     → {totalCost, totalInput, totalOutput}
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Electron 33, Node 20+ |
| Language | TypeScript 5.7 |
| Build | Yarn 4 + Turborepo + Vite 6 |
| Frontend | React 19 (+ design system TBD) |
| Database | SQLite (better-sqlite3) + Drizzle (available, unused) |
| Embeddings | HuggingFace Transformers.js (local, no network) |
| LLM Providers | Anthropic, OpenAI, Google, CodexOAuth |
| Packaging | Electron Forge |

---

## Next Steps (Recommended Order)

1. **Finalize Figma designs** → lock down component list + interactions
2. **Setup design system** (shadcn/ui + Tailwind in `@squirl/ui`)
3. **Build sidebar** → org/project/chat/branch tree with IPC wiring
4. **Build chat view** → messages + streaming + model selector
5. **Build right panel** → context/memory/artifacts/costs
6. **Build settings** → API keys + config
7. **Build branch actions** → fork, compare, rename, delete
8. **Polish** → keyboard shortcuts, animations, onboarding
9. **Package + distribute** → DMG/installer, auto-update
10. **Sync server** → when ready for team features
