# 05 — The Context Engine (the flagship)

> **This is the most important file.** It's the actual differentiator — "context, not chat." If you only read one deep technical section, make it this one. Source: `packages/graph-engine`, `packages/context-engine`, `packages/prompt-engine`, the classifier in `packages/ai-core`, and the living-memory store in `packages/database/src/global_memory.ts` + `apps/desktop/src/main/memory-detect.ts`.

## The thesis, restated as engineering

The product promise is: *never re-explain context to an AI again.* That promise is delivered by a **four-part pipeline**:

- **graph-engine** — a persistent, embedding-indexed **knowledge graph** of the project's decisions and constraints.
- **context-engine** — **RAG retrieval + MMR reranking** over that graph.
- **prompt-engine** — assembles everything into one **tiered payload** that degrades gracefully under a token budget.
- **classifier** (in ai-core) — runs in the background after every turn, distilling conversations into graph nodes, so retrieval gets *richer over time* without the user repeating themselves.
- **GlobalMemory** (in `database`) — the user-facing fact store, which is now a **living, self-evolving memory graph**: facts don't just accumulate, they supersede, reinforce, and expire (below).

There's a **write path** (turns → knowledge graph) and a **read path** (query → assembled context). Understand both and you understand the product.

---

## The write path: turns become knowledge

After every AI turn, a **classifier** (`packages/ai-core/src/classifier.ts`) fires (fire-and-forget). It asks a cheap model: *was this turn significant, and if so, what's the topic, intent, decision, constraint, artifact, and what earlier decision does it supersede?* Trivial chatter is dropped; significant turns become **nodes in the knowledge graph**.

Three things make this robust and worth describing:

1. **Two-tier classification with an enrich queue.** It tries the API model first. If the API is down, it falls back to a **local zero-shot classifier** (`Xenova/mobilebert-uncased-mnli`, runs offline via Transformers.js) which gives a coarse "significant/not." Those coarse nodes get pushed onto an **enrich queue** and *re-classified by the API later* once it recovers — so you get availability now and quality eventually.
2. **Crash-durable.** Both queues (`classifier_queue.json`, `classifier_enrich.json`) and a node-id counter (`graph_meta.json`) persist to disk, so a restart doesn't lose pending work or collide node ids.
3. **Exponential backoff** on failure (2s → 4s → … capped at 30s), reset on success.

Each node stores its text, a **384-dim embedding**, and provenance metadata: `_branch`, `_turn`, `_timestamp`. That `_branch` tag is the key that later enables cross-branch sharing and branch-diff.

## The knowledge graph itself (graph-engine)

- **Storage:** two SQLite tables — `nodes(id, text, embedding BLOB, domain, subtopic, meta, history)` and `edges(source, target, weight)`. The embedding is a raw Float32 little-endian blob.
- **Embeddings are 100% local, no network:** `Xenova/all-MiniLM-L6-v2` via HuggingFace Transformers.js, lazy-loaded, mean-pooled and **normalized**, sliced to 384 dims. If the model can't load, the whole pipeline degrades to empty retrieval rather than crashing.
- **Similarity search is a full table scan** — no ANN index, no vector extension. `queryAsync` embeds the query, scans every node, computes similarity, returns top-K. This is a deliberate simplicity trade-off that's fine for a per-project graph of hundreds-to-low-thousands of nodes. (Great scaling question — see below.)
- **"Cosine" is actually a bare dot product** — which is *correct only because embeddings are pre-normalized* (`dot(a,b) == cos(a,b)` for unit vectors). Elegant, and a latent footgun if an unnormalized vector ever entered.

### Nodes *evolve* — they don't just accumulate

When a new node is inserted, it scans for the most-similar existing node. If similarity ≥ **0.88** (the merge threshold), it's treated as the *same concept* — the metadata merges and the new decision/constraint is **appended to that node's `history` timeline** instead of creating a duplicate. So a topic like "auth strategy" becomes *one node with a decision history*, not fifty near-duplicate nodes. Edges are built to every other node above a **0.35** similarity threshold, making the graph a semantic-similarity graph where neighbors are conceptually-related knowledge.

(Cost: both the merge scan and edge scan are O(n) per insert → O(n²) as the graph grows. Fine at expected scale; an honest scaling limit.)

---

## GlobalMemory: living memory — "git for facts," not a self-mutating blob

Separate from the classifier's knowledge graph, **`GlobalMemory`** (`packages/database/src/global_memory.ts`) is the store behind the `remember` tool and the `<global_memory>` block — user-stated facts, scoped **global → project:id → chat:id → branch:id**. Until recently it was a flat JSON list with dedup-on-add and nothing else. That was a **live correctness bug**: "Alex works at Google" and, weeks later, "Alex works at Stripe" both persisted forever — dedup doesn't catch them (different text), so the model got fed *both, contradictory, with no recency signal.*

The fix, deliberately **not** framed as "a graph that rewrites itself" but as an **append-only fact log with typed edges and an `isLatest` view** — nothing is ever deleted:

- **Typed edges** replace a bare similarity weight: `updates` (A supersedes B — the crown jewel), `extends` (A enriches B, both stay active, rendered nested under the parent in `asContextBlock`), `relates` (plain similarity), `derives` (below).
- **Lifecycle by memory type.** `fact` persists until superseded. `preference` *strengthens* with repetition instead of duplicating — restating one bumps `reinforceCount`/`lastSeenAt`. `episode` decays — `expiresAt` drops it out of the working set via a `sweepExpired()` sweep (on startup + timer). Every path is soft: status flips to `superseded` / `expired` / `archived`, never a hard delete — always queryable as history, always restorable. This is the same ethos as "git for context never destroys context," applied to facts.
- **`derives` (inference) shipped gated + quarantined, OFF by default** (`memoryInference` setting, Settings → General → Memory). An inferred fact is typed `derived`, rendered `[inferred]` in the prompt so the model discounts it, linked to the facts it was inferred from, and — the hard safety rule — **can never supersede a stated fact.** Every hosted "self-evolving memory" demo leads with inference because it's flashy; it's also the fastest way to turn a trust-critical store into a confident-hallucination generator, so it's the one deliberately held back.

### Why supersession needs to be branch-aware — the actual moat

Hosted memory products (Supermemory, Zep, Mem0) are single-timeline: "latest" is global. Squirl's facts live on **branches**, and forks inherit context, so a naive global "latest" would let a supersession on one fork silently hide a fact on a *sibling* fork that never saw it. `isLatest` is instead **"latest along this branch's ancestry"**: `inWorkingSet(fact, ancestry)` only hides a superseded fact if the querying branch's ancestry set (its own id + all parents, the same walk `getAncestryMessages` already does for transcripts) contains the branch the supersession happened on. `asContextBlock`/`forBranch` take that ancestry set so a sibling fork's supersession never reaches the model. This is the concrete mechanism behind **"supermemory that branches and merges like git"** — and it sets up branch-merge as fact-conflict resolution later, reusing the same unique-vs-conflicting-decision logic `compareBranches` already computes (see Branch-diff, below).

### Detection pipeline (`memory-detect.ts`) — tiered, degrading, token-budgeted

Because this is local-first/BYOK (no server-side async job to lean on), detection runs **fire-and-forget after each turn**, like the classifier, and is built to degrade rather than block:

1. **Semantic shortlist** — rank same-scope candidate facts by the local embedder's cosine similarity (`@squirl/graph-engine`'s `embed`/`cosineSim`, zero API cost, cached per fact id). Catches low-vocabulary-overlap contradictions ("works at Google" → "joined Stripe") that a token-overlap check would miss; token overlap is kept only as the fallback when the embedder is unavailable.
2. **Tiered typing, with a durable local floor.** Prefer a cloud LLM when one is routable (classifier model → chat model) for higher-quality typing; when nothing is routable — no cloud model is *permanent*, and a Claude/Gemini-only BYOK user can't route the classifier's default free-on-Codex model — fall back to the **same local zero-shot NLI model the classifier uses** (`Xenova/mobilebert-uncased-mnli`, shared via `zeroShotClassify` in `ai-core`). The relation task maps onto NLI directly: contradiction ⇒ `updates`, entailment ⇒ `extends`, neutral ⇒ nothing. This local tier is the *always-available* floor, not just a fallback — detection never depends on a cloud model surviving.
3. **Asymmetric confidence.** `updates` is destructive (it hides a fact); `extends`/`relates` only add. So a supersession requires **two independent signals** — the model's `updates` verdict *and* a strong similarity score above `UPDATE_MIN_SCORE` — and a weak-confidence `updates` downgrades to `extends` (both facts kept, nothing hidden on a shaky signal).
4. **Panel accuracy.** `memory:for-branch` reports each fact's status *relative to the viewing branch* (`branchStatus` + ancestry) — a fact superseded on a sibling fork correctly shows as active there, matching exactly what the model would be sent.

Note what's deliberately **not** done: GlobalMemory and the classifier's `MetaGraph` stay two separate stores, not merged into one embedding index. They hold different content with different trust semantics (user-stated facts vs. classifier-inferred decisions), so `<global_memory>` and `<retrieved_context>` stay separate prompt blocks — "one living-memory model" is realized by GlobalMemory gaining structure, not by a risky migration into the graph's SQLite store.

---

## The read path: building context for a turn (prompt-engine)

`buildPayload` is the heart. It assembles a `systemContext` string from ordered, XML-tagged blocks, each carrying a plain-English instruction telling the model *how much to trust it*:

1. **`<global_memory>`** — durable facts, scoped **global → project → chat → branch** (narrower = more specific). Hierarchical memory.
2. **`<ancestry>`** — inherited context from parent branches (fork inheritance).
3. **`<conversation_summaries>`** — compacted older turns of *this* branch.
4. **`<retrieved_context>`** — the RAG block (the knowledge graph hits).
5. **`<pinned_rules>`** — user-pinned instructions, marked **BINDING**.
6. **`<selected_artifacts>`** — documents the user explicitly checkboxed to attach.

Then the **hot window**: the most recent turns go in *verbatim* as the actual API `messages`.

### RAG retrieval + MMR (context-engine) — the retrieval algorithm

When building `<retrieved_context>`, it calls `retrieveFromGraph(query, graph, topK=3, minScore=0.4, branchId)`:

1. **Over-fetch 5×** — pull `topK * 5` candidates (15 for topK=3) to give the reranker room to diversify.
2. **Cross-branch locality boost** — every branch's knowledge is eligible, but a node from the *current* branch gets a small +0.05 nudge. This is the concrete mechanism for **cross-branch knowledge sharing**: a decision made in one branch surfaces in a sibling branch.
3. **Neighbor expansion** — pull up to 10 graph neighbors of each hit and score them against the query too, catching conceptually-adjacent knowledge that raw vector search ranked just below the cutoff.
4. **MMR rerank** to the final 3.
5. **Render with provenance** — each surviving node becomes a compact line (`Topic / Decision / Constraint / Intent`), tagged **`(from branch X)`** when it came from a different branch, so the model knows where the knowledge originated.

**MMR (Maximal Marginal Relevance)** is the reranker. At each step it picks the candidate maximizing:

```
score = λ · relevance − (1 − λ) · maxSimilarityToAlreadyPicked      (λ = 0.7)
```

So a candidate that's highly relevant *but nearly a duplicate* of something already selected gets penalized. You get context that's **relevant AND non-redundant** — not three paraphrases of the same decision. λ=0.7 leans toward relevance over diversity. (This is a classic algorithm; being able to write the formula and explain the λ trade-off is a strong signal.)

The whole retrieval path is wrapped in `try/catch → []` — retrieval is best-effort and *never breaks a turn*.

### The crown jewel: graceful degradation under token pressure

After assembling everything, it counts tokens. If over the model's context limit, it drops blocks in a **deliberate priority order**:

1. Drop **`<conversation_summaries>`** first.
2. Then drop **`<ancestry>`**.
3. Only then start shifting out the **oldest hot messages** one at a time (always keeping ≥ 1).

**Never dropped:** `<pinned_rules>`, `<selected_artifacts>`, `<global_memory>`, `<retrieved_context>`.

The principle: **explicit user intent (pins, attached documents) strictly outranks machine-generated recall (summaries, ancestry).** And the lossiest / most-reconstructable context (summaries) sheds first. This ordering *is* the answer to "what gets dropped when you run out of context window?" — and it maps directly to the right-panel context inspector, so the user can literally *see* what the model saw and what was dropped.

### Progressive (hierarchical) summarization

Older turns don't just get truncated — they get *compressed hierarchically*:

- **raw turns → semantic-chunk summaries → meta-summaries.**
- **Semantic chunking** cuts a boundary where adjacent messages' embeddings diverge — but it *lowers the split threshold* (0.45 → 0.20) when consecutive messages share a file path, URL, capitalized entity, or form a tool→error flow, so a coherent topic stays together even when wording shifts.
- Once ≥ 5 chunk summaries pile up, all-but-the-last-two collapse into a single higher-level **meta-summary**. So memory stays bounded as conversations grow arbitrarily long.
- The summary prompts insist on preserving specific names/decisions verbatim and attributing "User decided X" vs "AI suggested Y."

### Two non-obvious correctness details (good "we hit this" stories)

1. **Hot window filters by real `turn` number, not array index.** Editing/deleting/retrying a mid-conversation message leaves gaps, and slicing by array position could accidentally drop the current user message and send an *empty* messages array — which Codex's bare `input` field 400s on. Filtering by the persisted `turn` field avoids it.
2. **`withToolTrail`** reattaches an assistant turn's tool activity to the text the model sees. Tool calls are stored *outside* message content (the UI renders them separately), so without this the model had **amnesia about its own actions** — the real bug was: *"what commands did you run?" → "I didn't run any."* Now up to 12 tool lines (`name(args) ✓ → result`) get folded back in.

---

## Branch-diff: the future "merge" primitive

`compareBranches` (`branch_diff.ts`) compares two branches' *decisions* using the knowledge graph:

- Finds their **common ancestor** by intersecting parent chains.
- Pulls each branch's decision nodes (filtered by the `_branch` tag).
- Keys them by topic and classifies: **`onlyInA` / `onlyInB`** (unique per branch) and **`shared`** where the topic matches but the decision *differs* — i.e. a **conflict**.

This is exactly the primitive a future git-style **merge** needs: *"both branches decided about auth, and they disagree."* It's why the roadmap can say "merge is mostly built already" — the hard part (finding unique-vs-conflicting decisions) exists and is wired to a `branch:compare` IPC.

---

## Putting it together (say this as the summary)

> After every turn, a background classifier distills the conversation into a local knowledge graph of decisions and constraints, embedded with a local MiniLM model — no network, no data leaving the machine. On each new turn, I embed the query, do a semantic search over that graph, expand to neighbors, and rerank with MMR so the context is relevant but not redundant — pulling in decisions made hundreds of turns ago or in a *different branch*, tagged with where they came from. Separately, the memory a user explicitly states is a *living* fact store, not a flat list: a contradicting fact supersedes the old one instead of both being fed to the model forever, restatement of a preference reinforces it, dated facts expire — and none of that is destructive, it's git-style: superseded facts stay as inspectable, restorable history, and a supersession on one branch never bleeds into a sibling fork that never saw it. All of that — memory, ancestry, hierarchical summaries, retrieved knowledge, pinned rules, and attached documents — gets assembled into a tiered prompt that degrades gracefully: when I run out of context window, machine-generated recall sheds before anything the user explicitly asked for. And the user can see the whole budget in a context inspector. That's how you never re-explain yourself to the AI — and never get *contradicted* by it, either.

## Likely drill-in questions & answers

- **"How would this scale to 100k nodes?"** Today it's a full table scan per query and O(n²) inserts — fine per-project. To scale: add an ANN index (sqlite-vss / FAISS / HNSW) and an indexed "nodes-by-branch" query (branch-diff currently iterates ids with a hacky `+100` gap tolerance).
- **"Why local embeddings?"** Privacy (local-first), no per-turn latency/cost, no shipping context to a third party. Trade-off: MiniLM is smaller/less accurate than a hosted embedding model — acceptable for topic-level retrieval.
- **"Isn't a full scan slow?"** Not at hundreds-to-low-thousands of nodes; a dot product over 384 floats is trivial. It becomes the bottleneck only at a scale a single project rarely reaches.
- **"What if the classifier is wrong / misses something?"** Retrieval is additive and best-effort; a missed node just isn't retrieved, and the user can always pin rules or attach artifacts explicitly (which never get dropped). Nothing breaks.
- **"How do you stop memory from going stale or self-contradicting?"** That was a real bug: a flat fact list can't tell "Alex works at Google" from its later, contradicting update — dedup only catches exact/near-identical text. The fix types the relationship instead of just linking similar facts: a detected contradiction adds an `updates` edge, which flips the old fact to `superseded` (never deleted — still queryable/restorable as history) and the `isLatest` view returns only the current one. Detection needs *two* agreeing signals (model verdict + high similarity) before it hides anything, because a false positive there is destructive.
- **"Why didn't you just merge GlobalMemory into the graph-engine's embedding store?"** They hold content with different trust semantics — user-stated facts vs. classifier-inferred decisions — and merging would've meant a risky migration for no retrieval benefit. Typing GlobalMemory's own edges got the "living memory" behavior without touching the store that already works.
- **"Why is supersession scoped to branch ancestry instead of just global?"** Because forks are a first-class feature here (unlike Zep/Mem0/Supermemory, which are single-timeline). If branch B corrects a fact, branch A — a sibling fork that forked *before* the correction — never saw it and shouldn't lose it. `isLatest` resolves against the same ancestry walk used for transcript reconstruction, so a correction only takes effect on branches that could have seen it happen.
