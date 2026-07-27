import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our custom text-* tokens are font SIZES (text-body-md, text-label-sm…).
// tailwind-merge can't know that: unregistered, it classifies them as text
// COLORS and drops the real color (text-primary-fg) as a duplicate. Same for
// the custom shadow names.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "heading-lg",
            "heading-md",
            "heading-sm",
            "body-lg",
            "body-md",
            "body-sm",
            "label-lg",
            "label-md",
            "label-sm",
          ],
        },
      ],
      shadow: [{ shadow: ["raised", "sunken", "float", "glow"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Counted noun for confirm-dialog copy: "1 memory", "3 chats". */
export function counted(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Duplicated from @squirl/providers rather than imported: that package reaches
// for node:fs, so the renderer can't load it.
const CLAUDE_SUBSCRIPTION_PREFIX = "claude_subscription/";

/**
 * Split a model id into what to show and how it's billed.
 *
 * Subscription-billed models carry a router namespace, and the raw id truncates
 * to an indistinguishable `claude_subscription/clau…` in a narrow menu — so show
 * the bare model name and move the billing path into a hint.
 */
export function modelLabel(id: string): { label: string; hint?: string } {
  return id.startsWith(CLAUDE_SUBSCRIPTION_PREFIX)
    ? { label: id.slice(CLAUDE_SUBSCRIPTION_PREFIX.length), hint: "subscription" }
    : { label: id };
}

/** Router entry name → provider logo key, for entries whose name isn't the brand. */
export function providerLogoKey(entry: string): string {
  if (entry === "codex_oauth") return "codex";
  if (entry === "claude_subscription") return "anthropic";
  return entry;
}
