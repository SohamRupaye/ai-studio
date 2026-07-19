# Design — Living memory: a branch-aware, self-evolving knowledge graph

Status: **design of record, not yet built** (2026-07-18). This is the plan for reworking Squirl's memory + graph into one model. Read `ONBOARDING.md` for project state, `DESIGN.md` for UI. When a phase lands, move its detail into the changelogs and check it off in the Phasing section.

## Context — why touch the thing that works

Context management is Squirl's USP, but "memory" and "knowledge" are two disconnected stores that don't evolve:

- **`GlobalMemory`** (`packages/database/src/global_memory.ts`) — a flat JSON list of `{id, text, scope, createdAt}` facts, hierarchically scoped (global→project→chat→branch), rendered into the `<global_memory>` prompt block. Just gained dedup-on-add; still has **no relationships, no recency, no lifecycle**.
- **`MetaGraph`** (`packages/graph-engine/src/graph.ts`) — an embedding fact-graph. Nodes carry `text`, `embedding`, `domain`, per-node `history`, and a `meta._branch` origin. Edges are `{source, target, weight}` — **untyped cosine similarity** (≥0.35 links, ≥0.88 merges). The classifier (`ai-core/classifier.ts:147`) writes nodes automatically per turn with a local-embedding fallback; retrieval (`retrieveFromGraph`, surfaced as `<retrieved_context>`) reads them.

The two never reference each other: the `remember` tool and auto-capture write to GlobalMemory; the classifier writes to the graph; a fact and the graph node about the same decision don't know they're the same thing. And critically, **nothing handles a fact *changing*.** "Alex works at Google" and, a month later, "Alex works at Stripe" both persist — dedup doesn't catch them (different text), similarity may even link them, and the model is fed both contradictory facts with no recency signal. That's a live correctness bug in the store whose entire value is being trustworthy.

**Goal:** one living knowledge model where facts connect to, supersede, and enrich other facts; stale facts fall out of the working set without being destroyed; and — the part nobody else has — all of this respects Squirl's branch/fork model.

## The core reframe — git for facts, not a self-mutating blob

Do **not** build "a graph that rewrites itself." Build an **append-only fact log with typed edges and an `isLatest` view.** Nothing is ever deleted:

- A fact that changes isn't overwritten — the new fact gets an incoming `updates` edge, and the old one drops out of the *working set* (still queryable as history).
- "Forgetting" is a status flag that excludes a fact from the prompt, **restorable**, never a delete.

This is the product ethos ("git for context never destroys context") applied to facts — and it's a *better* model than the hosted "self-evolving memory" framing because it stays inspectable and reversible, which the right panel's "here's exactly what the model will see" promise requires.

## Data model

Merge GlobalMemory into the graph: **facts become nodes, relationships become typed edges, lifecycle becomes node state.** The classifier becomes the single extraction pipeline. Concretely, extend `GraphNode`:

```
Fact node:
  id, text, embedding
  type: "fact" | "preference" | "episode"     // drives lifecycle (below)
  scope: global | project:<id> | chat:<id> | branch:<id>
  originBranch: string        // meta._branch today — which branch created it
  status: "active" | "superseded" | "archived" | "expired"
  createdAt, lastSeenAt, reinforceCount        // for decay/strengthen
  expiresAt?: number          // episodes / dated facts
  provenance: { turn, source: "remember" | "auto" | "derived" }
  history[]                   // already exists — keep
```

Typed edges (replace the bare `weight` with a `type`; keep similarity as a separate substrate):

- **`updates`** (directional, A→B: A supersedes B) — the crown jewel. Sets B's status `superseded`; the `isLatest` view returns A. Fixes the contradiction bug. **Just a typed edge on the graph we already have.**
- **`extends`** (A enriches B, both stay active) — we half-have this as similarity links; typing them is cheap and makes retrieval richer.
- **`relates`** (the existing cosine-similarity edge) — kept as the retrieval substrate, untyped, weighted.
- **`derives`** — **DEFERRED / gated, see below.**

## Branch-aware `isLatest` — the hard part and the actual moat

Hosted memory (Supermemory, Zep, Mem0) is single-timeline; their "latest" is global. Ours can't be — facts live on branches and forks inherit context. So:

- **`isLatest` is "latest along *this branch's* ancestry,"** not latest globally. An `updates` edge applied on branch B must **not** retroactively supersede the fact on branch A, its sibling fork. Supersession resolves against the same ancestry walk `getAncestryMessages` already does for transcripts.
- **Branch merge = fact conflict resolution.** When the future push/pull model merges branches, competing `updates` on the same underlying fact are exactly the conflict `prompt-engine`'s branch-diff logic already half-computes for decisions — reuse it, don't rebuild.

This is the headline. Not "supermemory" (a shipping product we'd be reimplementing) but **supermemory that branches and merges like git** — which only Squirl can do because only Squirl models context as branchable. Design everything else in service of this.

## The three relationships, decided

- **Updates — build first, champion it.** Directional supersession + `isLatest`. Fixes the live contradiction bug; most on-brand; lowest risk.
- **Extends — build, low risk.** Type the existing similarity links; keep both facts live.
- **Derives — DEFERRED for v1, gated if ever built.** Auto-generating inferences ("Alex *likely* works on core payments") and storing them as memory means the model later reads an inference as ground truth, and inferences compound on inferences. In a store whose whole value is reliability, this is the fastest way to poison it. If it ever ships: never let a derived fact supersede a stated one, never persist it silently, label it `[inferred]` in the payload so the model discounts it, and keep it out of the trusted set. Every hosted demo leads with Derives because it's flashy; it's also the one that turns the USP into a confident-hallucination generator.

## Lifecycle by memory type

- **Fact** — persists until an `updates` edge supersedes it.
- **Preference** — *strengthens* with repetition (`reinforceCount`); a re-stated preference isn't a dup, it's reinforcement.
- **Episode** — decays; `expiresAt` for dated ones ("meeting at 3pm today" → expired after today; "exam tomorrow" → expired after the date). Expiry is safe *scoping*, not destruction.

"Forgetting" mechanisms, all soft: **time-expiry** (episodes), **contradiction** (= the `updates` edge, already covered), **noise-filtering** (already done by the classifier + dedup — extend it). Everything archives, never hard-deletes. This subsumes the parked memory-decay debt entry — build it here, not separately.

## Extraction + typing pipeline (token-budgeted — this is local-first, BYOK)

Every step is an LLM call on *the user's own tokens*, possibly a small model. Hosted services do this async server-side; we can't. So keep the classifier's async fire-and-forget + local-embedding fallback, and **bound the work**:

1. **Extract** candidate facts from the turn (classifier — already does this; extend to emit a `type` per fact).
2. **Embed** each new fact (local embedder, already present).
3. **Shortlist** candidate existing memories by cosine (top-K in-scope neighbors) — cheap, no LLM.
4. **Type edges in ONE batched LLM call**: "does this new fact update / extend / relate to any of these K candidates?" — never O(facts × memories) calls. Falls back to `relates`-only (pure similarity, no LLM) when no model is available or the budget is spent.
5. **Apply** edges + status changes transactionally.

Heavy paths must degrade gracefully: no model / offline / small model → similarity-only graph (i.e. today's behavior). The feature is additive, never a hard dependency.

## Retrieval + context assembly changes

`buildPayload` (`prompt-engine/context.ts`) today emits `<global_memory>` (from `globalMem.asContextBlock`) and `<retrieved_context>` (from `retrieveFromGraph`) as separate blocks. After the merge:

- One query: **"active (non-superseded, non-expired), in-ancestry-scope, relevant"** facts — MMR over the graph, filtered by `isLatest` + branch ancestry + status.
- `<global_memory>` becomes the always-included scoped facts; `<retrieved_context>` becomes the relevance-retrieved neighbors — same two blocks, now backed by one store with recency/lifecycle applied. Superseded/expired facts never enter the working set (but remain for history/UI).

## UI / trust (the right panel's promise)

A self-evolving store fights "here's exactly what the model will see" unless evolution is **visible and reversible**. The git framing pays this back:

- A memory shows its **supersession chain** (what it replaced / what replaced it).
- Forgotten/expired facts show **why and when**, with a **restore**.
- The knowledge-graph page visualizes typed edges (updates/extends/relates) distinctly.

## Migration

- `GlobalMemory` JSON facts → graph nodes (`type: "fact"`, `status: "active"`, scope/originBranch carried over). Keep the JSON file as a one-time backup until verified.
- Existing graph nodes gain `type`/`status`/lifecycle defaults (migrated columns — follow the schema rule: added in `applyMigrations`, never the `SCHEMA` block; graph has its own SQLite in `graph-engine`).
- The `remember` tool and `memory:*` IPC keep working against the new store (facade stays; internals change).

## Implementation status (2026-07-18 — all phases built, uncommitted, typecheck + tests green)

Built end-to-end on `GlobalMemory` (the user-facing fact store), which is now a living fact-graph. Deliberate deviations from the plan below, all so the work stays low-risk and shippable:

- **Phase 4 was NOT a physical store merge.** GlobalMemory and MetaGraph stay separate stores (they hold different content — user facts vs. classifier decisions — with different trust semantics), and `<global_memory>`/`<retrieved_context>` stay separate blocks for the same reason. "One living-memory view" is realized by GlobalMemory gaining typed fact-to-fact edges and `asContextBlock` rendering the structure (extends-children nest under their parent). The risky migration into MetaGraph's embedding store was judged unnecessary for the model the user described.
- **Phase 5 is branch-aware on the prompt path only.** `asContextBlock`/`forBranch` take a branch `ancestry` set (computed in `buildPayload`) so a sibling fork's supersession never hides a fact from the model. The right-panel `memory:for-branch` view still shows global supersession state (a fact superseded on a sibling shows in "History" there) — a display inaccuracy, not a context one. Full per-branch panel status + branch-merge conflict resolution remain for when the multi-user merge feature exists.
- **Phase 6 (Derives) shipped gated + quarantined, OFF by default** (`memoryInference` config, Settings → General → Memory). Inferred facts are typed `derived`, labeled `[inferred]` in the prompt, linked to their sources, and can never supersede a stated fact.
- **Detection (phase 3) is async + degrading**: shortlist → one batched LLM call on the org router → apply. Runs fire-and-forget after each turn, like the classifier.

**Detection quality pass (2026-07-19) — `main/memory-detect.ts`:**
- **① Semantic shortlist** via the local embedder (`embed`/`cosineSim` from `@squirl/graph-engine`, zero API cost, cached per fact id). Ranks candidates by embedding similarity so a low-vocabulary-overlap contradiction ("works at Google" → "joined Stripe") still surfaces — the token-overlap `relatedCandidates` is now only the fallback when the embedder is unavailable. `GlobalMemory.candidatePool()` provides the raw same-scope pool; the ranking lives in main so the database package keeps no embedder dependency.
- **② No silent dark-mode + a durable LOCAL floor.** The classifier model default (`gpt-5.4-mini`) is free only for Codex-subscription users and unroutable for a Claude-/Gemini-only BYOK user (Haiku etc. cost BYOK tokens) — and no cloud model is permanent. So detection is **local-first-capable**, tiered: (1) cloud LLM when routable — classifier model → chat model, higher quality and free for Codex users; (2) **local NLI** (`Xenova/mobilebert-uncased-mnli` via `@huggingface/transformers`, already bundled for the significance classifier) — on-device, free, no key, doesn't depend on any cloud model surviving. The relation task maps onto NLI: contradiction ⇒ `updates`, entailment ⇒ `extends`, neutral ⇒ none. Local NLI is the always-available floor; only if the local model can't load do we degrade to relates-only. The zero-shot pipeline is shared with the classifier via a new `zeroShotClassify` export in `@squirl/ai-core` (loads the model once). Local NLI is smaller/noisier than an LLM, but its strength (contradiction detection) is exactly the high-value `updates` call, and ③'s similarity gate contains false supersessions.
- **③ Asymmetric confidence.** `updates` hides a fact (destructive); `extends`/`relates` only add. A supersession now requires TWO signals — the model's `updates` verdict AND a strong similarity score (`UPDATE_MIN_SCORE`); a weak-confidence `updates` is downgraded to `extends` (both facts kept). Prevents a shaky signal from hiding a true fact.
- **Panel accuracy fix**: `memory:for-branch` now reports each fact's status *relative to the viewing branch* (`GlobalMemory.branchStatus` + ancestry) — a fact superseded on a sibling fork shows as active there, matching what the model sees. (Was global-only.)

Auto-detection now removes phase 1's "model must flag supersession" limit (the model's explicit `supersedes` path still works too). Everything is append-only — nothing is ever hard-deleted; forgetting = a status flag + restore.

## Phasing (each phase shippable, verified before the next)

1. **Thin vertical slice — `updates` + `isLatest`.** Node `status`, the `updates` edge, ancestry-scoped `isLatest`, retrieval filtered to active facts. Proves the model and **fixes the contradiction bug** with the least surface. ← start here.
2. **Memory types + lifecycle** (fact/preference/episode, decay/reinforce/expiry, soft-forget). Absorbs the decay debt entry.
3. **Extends** (type the similarity links) + the batched typing pipeline + token budget.
4. **Merge GlobalMemory into the graph fully**; unify the two prompt blocks; migration.
5. **Branch merge conflict resolution** (reuse branch-diff) — lands with/after the multi-user push/pull phase.
6. **Derives** — only if demanded, gated as above.
7. **UI**: supersession chains, restore, typed-edge graph view.

## Open questions / risks to resolve in phase 1

- **Token cost on small default models** — is the batched typing call acceptable per turn, or should it be debounced/batched across turns like summarization? (Lean: piggyback the classifier's existing async queue.)
- **`isLatest` performance** — ancestry-filtered "latest" over a growing graph needs an index strategy, not a full scan (today's `addNode` already does an O(n) scan for merge candidates — that's a pre-existing scale smell to fix alongside).
- **Determinism** — same turn shouldn't produce different edges run-to-run; the local fallback must be stable.
- **Merge semantics detail** — deferred to phase 5, but the phase-1 `updates` edge must be shaped so branch-scoped supersession is possible without a later rewrite.

## Verification (per phase, but especially phase 1)

State a fact, then contradict it on the same branch → the model sees only the current one; the old one is visible-as-history in the panel, not gone. Do the same on a fork → the fork updates, the sibling branch does **not**. Confirm the whole pipeline degrades to today's similarity-only behavior with no model / no embedder.
