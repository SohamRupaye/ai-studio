import * as React from "react";
import { cn } from "../../lib/utils";

// Keycap: raised like a real key (shadow-raised carries the inset top-light
// in dark mode). Sans, not mono — mono is reserved for data.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 select-none items-center justify-center rounded-xs border border-line bg-surface-2 px-1 font-sans text-label-sm text-fg-muted shadow-raised",
        className,
      )}
      {...props}
    />
  );
}

// Convenience for chords: <KbdGroup keys={["⌘", "K"]} />
function KbdGroup({
  keys,
  className,
  ...props
}: React.ComponentProps<"span"> & { keys: string[] }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} {...props}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}

export { Kbd, KbdGroup };
