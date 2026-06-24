import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium font-mono transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary/15 text-primary border border-primary/20",
        highlight:
          "bg-highlight/15 text-highlight border border-highlight/25",
        secondary:
          "bg-secondary text-secondary-foreground border border-border",
        success:
          "bg-success/15 text-success border border-success/20",
        warning:
          "bg-warning/15 text-warning border border-warning/20",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/20",
        outline:
          "border border-border text-muted-foreground bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
