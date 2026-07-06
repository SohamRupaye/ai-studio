import * as React from "react";
import { cn } from "../../lib/utils";

const sizes = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-4 border-2",
  lg: "size-5 border-2",
} as const;

// Ring spinner — takes its color from `currentColor`, so tint it with any
// text-* class (defaults to muted).
interface SpinnerProps extends React.ComponentProps<"span"> {
  size?: keyof typeof sizes;
}

function Spinner({ className, size = "md", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent text-fg-muted",
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
