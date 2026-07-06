import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Status tints only — no colored chips for decoration. Neutral is the default;
// color must mean something (state, not category). Text sits a tone deeper
// than the tint (*-text tokens) so the pill reads solid, not washed out.
const badgeVariants = cva(
  "inline-flex shrink-0 select-none items-center gap-1.5 rounded-full px-3.5 py-2 text-label-md whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-surface-3 text-fg-muted",
        outline: "border border-line text-fg-muted",
        info: "bg-info-soft text-info-text",
        success: "bg-success-soft text-success-text",
        warning: "bg-warning-soft text-warning-text",
        danger: "bg-danger-soft text-danger-text",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants, type BadgeProps };
