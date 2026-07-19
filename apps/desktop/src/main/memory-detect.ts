/**
 * Automatic memory relationship detection (living memory, phase 3 + quality pass).
 *
 * After a turn adds facts, this classifies each new fact against a bounded
 * shortlist of existing same-scope facts and records the relationship:
 *   - updates  → the new fact supersedes the old one (drops out of the model's
 *                view; old kept as history).
 *   - extends  → the new fact enriches the old; both stay active, linked.
 *   - relates  → similarity substrate, recorded deterministically (no LLM).
 *
 * Quality pass (2026-07-19):
 *   ① Semantic shortlist. Candidates are ranked by EMBEDDING similarity (the
 *      local embedder from @squirl/graph-engine — zero API cost), not just token
 *      overlap, so a contradiction with little shared vocabulary ("works at
 *      Google" → "joined Stripe") still surfaces as a candidate. Falls back to
 *      the token-overlap shortlist when the embedder is unavailable.
 *   ② No silent dark-mode. The classifier model (getConfig().classifierModel,
 *      default gpt-5.4-mini) is unavailable for BYOK users without that
 *      provider — so detection falls back to the CHAT model (which just ran the
 *      turn, so it's always available). The feature is no longer silently off
 *      for Claude-/Gemini-only users. Genuine total failure is logged, not swallowed.
 *   ③ Asymmetric confidence. `updates` HIDES a fact (destructive); `extends`/
 *      `relates` only add. So a supersession requires TWO signals — the model's
 *      "updates" verdict AND a strong similarity score. A low-confidence
 *      "updates" is downgraded to `extends` (keeps both facts) rather than
 *      silently hiding a true fact.
 *
 * Runs fire-and-forget after the turn, like the classifier. Bounded: a handful
 * of new facts, a handful of candidates each, one batched LLM call per new fact.
 */
import type { Router } from "@squirl/providers";
import { getConfig } from "@squirl/providers";
import { embed, cosineSim } from "@squirl/graph-engine";
import { zeroShotClassify } from "@squirl/ai-core";
import type { GlobalMemory, MemoryFact, MemoryScope } from "@squirl/database";
import { globalMem, mainWindow } from "./state.js";

const MAX_NEW_FACTS_PER_TURN = 3;
const MAX_CANDIDATES = 5;
const POOL_CAP = 50;
const RELATES_MIN_SCORE = 0.5;   // deterministic relates-edge threshold
const CANDIDATE_MIN_SCORE = 0.3; // below this, not even shown to the model
const UPDATE_MIN_SCORE = 0.6;    // ③ supersession needs a strong match, not just a verdict

const DETECT_PROMPT =
  `You classify how a NEW memory fact relates to each EXISTING fact. For each candidate return one relation:\n` +
  `- "updates": the new fact makes the existing one obsolete or contradicts it (same subject, changed value — e.g. a new job, a moved city, a changed preference).\n` +
  `- "extends": the new fact adds detail to the existing one without replacing it.\n` +
  `- "none": unrelated, or merely similar.\n` +
  `Reply with ONLY a JSON array: [{"id": <candidateId>, "relation": "updates|extends|none"}]. No prose.`;

// Embedding cache keyed by fact id. Facts never change text (supersession mints
// a new fact), so id is a stable key. Bounded to avoid unbounded growth.
const embedCache = new Map<number, number[]>();
const EMBED_CACHE_CAP = 2000;

async function embedFact(fact: { id: number; text: string }): Promise<number[]> {
  const cached = embedCache.get(fact.id);
  if (cached) return cached;
  const vec = await embed(fact.text);
  if (vec.length) {
    if (embedCache.size >= EMBED_CACHE_CAP) embedCache.delete(embedCache.keys().next().value as number);
    embedCache.set(fact.id, vec);
  }
  return vec;
}

interface Candidate { fact: MemoryFact; score: number }

/** ① Rank same-scope candidates by embedding similarity; fall back to the
 * token-overlap shortlist when the embedder isn't available. */
async function shortlist(mem: GlobalMemory, fact: MemoryFact): Promise<Candidate[]> {
  const selfVec = await embedFact(fact);
  if (!selfVec.length) {
    // Embedder unavailable → deterministic token-overlap fallback.
    return mem.relatedCandidates(fact.id, MAX_CANDIDATES);
  }
  const scored: Candidate[] = [];
  for (const cand of mem.candidatePool(fact.id, POOL_CAP)) {
    const vec = await embedFact(cand);
    if (!vec.length) continue;
    const score = cosineSim(selfVec, vec);
    if (score >= CANDIDATE_MIN_SCORE) scored.push({ fact: cand, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

/**
 * Per-candidate relations, cloud-preferred with a DURABLE LOCAL FLOOR.
 * Tiering (see the model-durability note in the design doc):
 *  1. Cloud LLM — higher quality, and free for Codex-subscription users
 *     (gpt-5.4-mini). Tries the classifier model, then the chat model.
 *  2. Local NLI — on-device, free, no BYOK/subscription, doesn't depend on any
 *     specific cloud model persisting. The always-available floor when no cloud
 *     model is routable (a Claude-/Gemini-only user, or after gpt-5.4-mini is
 *     eventually retired). Only if the local model can't load do we fall to
 *     relates-only (the deterministic edges already applied above).
 */
async function classifyRelations(
  router: Router,
  chatModel: string,
  fact: MemoryFact,
  candidates: Candidate[],
): Promise<Array<{ id: number; relation: string }>> {
  const list = candidates.map((c) => `#${c.fact.id}: ${c.fact.text}`).join("\n");
  const cloud = await cloudClassify(router, chatModel, `NEW fact: ${fact.text}\n\nEXISTING candidates:\n${list}`, DETECT_PROMPT)
    .catch((e) => { console.warn("[memory-detect] cloud classify failed, using local NLI:", (e as Error)?.message ?? e); return null; });
  const json = cloud?.match(/\[[\s\S]*\]/)?.[0];
  if (json) {
    try { return JSON.parse(json); } catch { /* fall through to local */ }
  }
  // Local NLI floor — one on-device pass per candidate pair.
  const out: Array<{ id: number; relation: string }> = [];
  for (const c of candidates) {
    const rel = await classifyRelationLocal(c.fact.text, fact.text);
    if (rel && rel !== "none") out.push({ id: c.fact.id, relation: rel });
  }
  return out;
}

/** ② Cloud classify: classifier model, then chat model (always available — it
 * just ran the turn). Returns null when no cloud model is routable (→ local). */
async function cloudClassify(
  router: Router,
  chatModel: string,
  prompt: string,
  system: string,
): Promise<string | null> {
  const models = [getConfig().classifierModel, chatModel].filter((m, i, a) => m && a.indexOf(m) === i);
  for (const model of models) {
    try {
      const result = await router.call(model, [{ role: "user" as const, content: prompt }], system);
      return result.text;
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      // Only fall through when the model can't be routed (no provider / no key).
      if (!/no provider|not found|api key|unauthor/i.test(msg)) throw e;
    }
  }
  return null;
}

// Local NLI relation labels (index → relation). mobilebert-MNLI scores each by
// entailment against the framed pair; contradiction ⇒ updates is its strength.
const NLI_LABELS = [
  "the new statement contradicts or replaces the earlier statement",
  "the new statement adds more detail to the earlier statement",
  "the two statements are unrelated",
] as const;
const NLI_RELATIONS = ["updates", "extends", "none"] as const;
const NLI_MIN_SCORE = 0.5;

/** Classify one pair with the local NLI model. null ⇒ local model unavailable. */
async function classifyRelationLocal(oldText: string, newText: string): Promise<"updates" | "extends" | "none" | null> {
  const r = await zeroShotClassify(`Earlier statement: "${oldText}". New statement: "${newText}".`, [...NLI_LABELS]);
  if (!r) return null;
  const idx = NLI_LABELS.indexOf(r.labels[0] as (typeof NLI_LABELS)[number]);
  if (idx < 0 || (r.scores[0] ?? 0) < NLI_MIN_SCORE) return "none";
  return NLI_RELATIONS[idx]!;
}

export async function detectMemoryRelationships(
  router: Router,
  chatModel: string,
  scope: MemoryScope,
  sinceMs: number,
  branchId: string,
): Promise<void> {
  const mem: GlobalMemory = globalMem;
  const newFacts = mem
    .list(scope)
    .filter((f) => f.createdAt >= sinceMs)
    .slice(0, MAX_NEW_FACTS_PER_TURN);
  if (!newFacts.length) return;

  let changed = false;
  for (const fact of newFacts) {
    const candidates = await shortlist(mem, fact);
    if (!candidates.length) continue;

    // Deterministic substrate: link strongly-similar facts as "relates"
    // regardless of the model — the whole mechanism when offline.
    for (const c of candidates) {
      if (c.score >= RELATES_MIN_SCORE && mem.addEdge(fact.id, c.fact.id, "relates", c.score)) {
        changed = true;
      }
    }

    const relations = await classifyRelations(router, chatModel, fact, candidates);

    for (const r of relations) {
      const cand = candidates.find((c) => c.fact.id === r.id);
      if (!cand) continue;
      if (r.relation === "updates" && cand.score >= UPDATE_MIN_SCORE) {
        // ③ Strong match + model verdict → supersede (the candidate becomes history).
        if (mem.supersede(cand.fact.id, fact.id, branchId)) changed = true;
      } else if (r.relation === "updates" || r.relation === "extends") {
        // Weak-confidence "updates" is downgraded to a safe, additive link —
        // never hide a fact on a shaky signal.
        if (mem.addEdge(fact.id, cand.fact.id, "extends")) changed = true;
      }
    }

    if (getConfig().memoryInference) {
      changed = (await maybeDerive(router, chatModel, fact, candidates, scope, branchId)) || changed;
    }
  }

  if (changed) mainWindow?.webContents.send("memory:changed", undefined);
}

async function maybeDerive(
  router: Router,
  chatModel: string,
  fact: { id: number; text: string },
  candidates: Array<{ fact: { id: number; text: string } }>,
  scope: MemoryScope,
  branchId: string,
): Promise<boolean> {
  try {
    // Inference generation needs a generative model — local NLI can't produce
    // new text — so derives is cloud-only (and off by default anyway).
    const list = candidates.map((c) => `#${c.fact.id}: ${c.fact.text}`).join("\n");
    const text = await cloudClassify(
      router,
      chatModel,
      `New fact: ${fact.text}\n\nRelated facts:\n${list}`,
      `From these facts, state ONE genuinely new, high-confidence inference that none of them states outright — or reply exactly "NONE" if nothing is safely inferable. Reply with ONLY the single inferred statement or NONE, no preamble.`,
    );
    const inferred = text?.trim();
    if (!inferred || /^none$/i.test(inferred) || inferred.length > 300) return false;
    globalMem.addDerived(inferred, scope, [fact.id, ...candidates.map((c) => c.fact.id)], branchId);
    return true;
  } catch {
    return false;
  }
}
