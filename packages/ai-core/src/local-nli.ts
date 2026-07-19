/**
 * Local zero-shot classification via @huggingface/transformers
 * (Xenova/mobilebert-uncased-mnli) — on-device, free, no API key, and durable:
 * it doesn't depend on any cloud model that could be deprecated or gated behind
 * a subscription/BYOK key. Shared by the significance classifier and by memory
 * relationship detection so the model is loaded once.
 */
let pipe: any = null;
let failed = false;

/**
 * Classify `text` against `labels` using local NLI. Returns labels + scores
 * sorted best-first, or null if the local model can't be loaded/run (caller
 * degrades from there). The mobilebert-MNLI model scores each label by
 * entailment against the text — well-suited to "does A contradict B" judgments.
 */
export async function zeroShotClassify(
  text: string,
  labels: string[],
): Promise<{ labels: string[]; scores: number[] } | null> {
  if (failed) return null;
  try {
    if (!pipe) {
      const { pipeline } = await import("@huggingface/transformers");
      pipe = await pipeline("zero-shot-classification", "Xenova/mobilebert-uncased-mnli", { dtype: "fp32" });
    }
    const result = await pipe(text, labels);
    return { labels: result.labels, scores: result.scores };
  } catch {
    failed = true;
    return null;
  }
}
