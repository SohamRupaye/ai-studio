# 13 — Demo Script & Talking Points

> A suggested walkthrough of the app for a live demo or screen-share. The goal is to *show the thesis* (context is the object) in ~5-10 minutes, not to tour every screen. Lead with the story, let the UI back it up.

## Before starting

- Have `yarn dev` already running (Vite on 5173 + Electron). Main-process changes need a restart, so avoid touching backend code mid-demo.
- Have a project with *some accumulated history* — a few branches, some attached artifacts, a couple of memories, an MCP server connected. An empty app doesn't tell the story.
- Know the escape hatch: if something's a placeholder page (Home, Knowledge-graph view, Compare, Costs), say "that page is still a placeholder — the data behind it is live, the view isn't built yet" and move on. Don't stumble into a dead screen.

## The narrative arc (what's being shown)

1. Context is a durable, visible, controllable object — not a throwaway chat.
2. You can branch/fork that context like code.
3. It's model-agnostic and extensible (providers, MCP, skills).
4. It's local-first and yours.

## Beat-by-beat

### Beat 1 — The frame (30 seconds, before touching anything)

> "Every AI conversation today starts from zero — you re-explain your project every time, to every tool, and so does your teammate. This is 'Git for AI context': the context accumulates, you branch it like code, and you never re-explain yourself. Let me show you."

### Beat 2 — The hierarchy & the sidebar (1 min)

- Point at the **project rail** and **sidebar**: "Organisation → Project → **Space** → Chat → Branch. Spaces are functional areas — Design, Development, Business — which map exactly to how my pilot customer hands off work."
- Expand a space: memories, artifacts, chats, branches. "Everything a space knows lives here."
- Note: "You never work 'in a chat' — you always work *on a branch*, like a git checkout."

### Beat 3 — Send a message & the right panel (2 min) ⭐ the core moment

- Send a message that would benefit from prior context ("continue where we left off on X").
- **Open the right panel — the context inspector.** This is the whole thesis made visible:
  - The **donut meter** = the token budget, broken into tiers (system, memories, retrieved, artifacts, history).
  - "The model isn't a black box here — I can *see* exactly what it's being told and how much room is left."
- As it streams: point at the **tool-activity rows** ("it ran these tools, and I can see the actual arguments") and, if it delegates, the **subagent drawer** ("that's a subagent's full live transcript, not a spinner").
- The takeaway line: "That retrieved-context tier? Those are decisions from earlier in this project — even from *other branches* — that a background process distilled into a knowledge graph. I didn't paste any of it."

### Beat 4 — Branching / forking (1.5 min) ⭐ the "Git" moment

- On any assistant message, hit **branch-from-here** (or fork a branch from the sidebar menu).
- "This forks the conversation at this exact point — the new branch inherits all the context up to here, *and* the attached documents, but diverges from here. Exactly like `git branch`."
- Switch between the two branches to show they're independent lines that share a common history.
- Mention: "Because each branch's decisions live in the knowledge graph tagged by branch, I can even *diff* two branches — find where they agree and where they made conflicting decisions. That's the seed of a future git-style merge."

### Beat 5 — Attach an artifact / control the context (1 min)

- In the right panel's **Artifacts** section, checkbox a document to attach it. "This document is now guaranteed in the prompt — pinned context never gets dropped, even under token pressure. Explicit user intent beats machine recall."
- Watch the meter re-project ("≈ N tokens with current selection").

### Beat 6 — Model-agnostic + extensibility (1.5 min)

- Open the **model switcher** in the topbar: "Same context, any model — Claude, GPT, Gemini, or ChatGPT via OAuth with no API key. The value is the context layer, not any one model."
- Flash **Settings → MCP servers**: "Connect external tools — Notion, GitHub, Linear — over the open Model Context Protocol, with a full OAuth flow I built to spec."
- Flash **Settings → Skills**: "Reusable capabilities as `SKILL.md` folders — install from GitHub, invoke with `/name` or let the model discover them."

### Beat 7 — Close on the thesis (30 seconds)

> "Everything you saw is local — SQLite, local embeddings, your keys. It's your context, and it compounds. The roadmap is team handoff: push a Space to the next person so their AI starts where yours left off. That's the part my pilot actually needs, and the branch-diff engine is already most of it."

## Fallback talking points (if the live app misbehaves)

Don't panic — pivot to the *engineering*:
- "Let me show you the code instead" → open `packages/prompt-engine/src/context.ts` and walk `buildPayload`'s tiering.
- Or open `packages/tools-runtime/src/mcp/oauth.ts` and walk the OAuth flow.
- Or the `event-bus` contract to show the typed IPC boundary.

## What NOT to do

- Don't tour placeholder pages.
- Don't get lost in settings sub-tabs — flash them, don't explore them.
- Don't over-explain the design system unless asked (it's in `09` if they go there).
- Don't claim things that are debt (registered OAuth apps, tree-sitter) as done — see the honesty guards in `14`.

## One-liner to end on

> "The bet is simple: as everyone works with AI, the scarce thing won't be model access — it'll be *context that persists and travels*. This is the tool for that."
