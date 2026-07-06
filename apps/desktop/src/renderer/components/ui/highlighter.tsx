import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Inline text highlight. Amber (Highlighter-pen) by default; box-decoration-clone
// keeps the tint wrapping cleanly across line breaks.
const HighlighterVariants = cva("rounded-xs box-decoration-clone px-[3px] py-px text-fg", {
  variants: {
    tone: {
      amber: "bg-warning-soft",
      info: "bg-info-soft",
      success: "bg-success-soft",
      danger: "bg-danger-soft",
      neutral: "bg-surface-3",
    },
  },
  defaultVariants: {
    tone: "amber",
  },
});

interface HighlighterProps
  extends React.ComponentProps<"mark">,
    VariantProps<typeof HighlighterVariants> {}

function Highlighter({ className, tone, ...props }: HighlighterProps) {
  return <mark className={cn(HighlighterVariants({ tone }), className)} {...props} />;
}

export { Highlighter, HighlighterVariants };
