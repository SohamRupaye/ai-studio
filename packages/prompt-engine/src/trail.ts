import type { Message } from "@squirl/shared";

/**
 * Reattach a turn's tool activity to the assistant text the model sees. The
 * transcript stores tool calls OUTSIDE message content (the UI renders them
 * separately), so without this the model has no memory of its own actions on
 * later turns — "what commands did you run?" got "I didn't run any".
 * Previews are capped at persist time; the line count is capped here.
 *
 * Used by the hot window (context.ts) AND by summarization prompts
 * (summarizer.ts) — a summarized turn must keep the identifiers its tool
 * calls produced (page ids, URLs), or the model loses track of things it
 * created once those turns compact.
 */
const TOOL_TRAIL_MAX_CALLS = 12;
export function withToolTrail(m: Message): string {
  if (m.role !== "assistant" || !m.toolCalls?.length) return m.content;
  const shown = m.toolCalls.slice(0, TOOL_TRAIL_MAX_CALLS);
  const lines = shown.map((tc) => {
    const args = tc.argsPreview ? `(${tc.argsPreview})` : "";
    const out = tc.resultPreview ? ` → ${tc.resultPreview}` : "";
    return `- ${tc.name}${args} ${tc.success ? "✓" : "✗ failed"}${out}`;
  });
  const more = m.toolCalls.length > shown.length ? `\n- …and ${m.toolCalls.length - shown.length} more calls` : "";
  return `${m.content}\n\n[Tool calls you made during this turn (abbreviated):\n${lines.join("\n")}${more}]`;
}
