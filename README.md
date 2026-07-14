# Squirl 🐿️

> A model-agnostic organizational intelligence layer — like Git for AI-native work.

Context is the primary object, not chat. Squirl accumulates knowledge, decisions, reasoning, and artifacts across branches so you never re-explain context to an AI again.

## Status

Backend complete. Frontend in active development.

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Electron 33, Node 20+ |
| Language | TypeScript 5.7 |
| Build | Yarn 4 + Turborepo + Vite 6 |
| Frontend | React 19 |
| Database | SQLite (better-sqlite3) |
| Embeddings | HuggingFace Transformers.js (local, no network) |
| LLM Providers | Anthropic, OpenAI, Google, Codex OAuth |
| Packaging | Electron Forge |

## Getting Started

**Prerequisites:** Node ≥ 20, Yarn 4

```bash
make install   # install dependencies
make dev       # start all packages in watch mode
make desktop   # launch Electron app (dev)
```

## Architecture

```
packages/
  shared          → Core types (Message, Branch, Org, Project, Chat)
  tokenizer       → Token counting + model context limits
  event-bus       → Typed IPC contracts (40+ channels)
  database        → SQLite store with full org/project/chat/branch hierarchy
  graph-engine    → SQLite-backed knowledge graph + local MiniLM-L6 embeddings
  providers       → Anthropic / OpenAI / Google / Codex OAuth + retry router
  context-engine  → RAG retrieval with MMR reranking, cross-branch knowledge sharing
  prompt-engine   → Tiered context builder + progressive summarization
  ai-core         → Agent loop, classifier, cost tracker, artifact extractor
  tools-runtime   → 50+ tools, MCP client, LSP client, Skills system
  ui              → React hooks
apps/
  desktop         → Electron app (main process + renderer)
tooling/
  eslint          → Shared ESLint config
  typescript      → Shared tsconfig
  vitest          → Shared Vitest config
```

## Common Commands

```bash
make help           # list all available commands

make build          # build all packages
make test           # run all tests
make lint           # lint all packages
make typecheck      # type-check all packages
make clean          # remove build artifacts

make desktop-build  # build desktop app
make desktop-package # package into distributable
```

## License

UNLICENSED — private project.
