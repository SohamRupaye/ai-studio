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
