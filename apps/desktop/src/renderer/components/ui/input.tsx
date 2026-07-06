import * as React from "react";
import { cn } from "../../lib/utils";

// Fields sit one gentle step above the canvas (surface-1) — the sunken/carved
// treatment read as a black pit in dark mode and was dropped. Focus lifts the
// field one more step (surface-2) and firms the border; no focus ring.
const fieldSurface =
  "rounded-md border border-line bg-surface-1 " +
  "transition-[border-color,background-color] duration-100 " +
  "hover:border-line-strong focus:outline-none focus-visible:outline-none";

const fieldText =
  "text-body-md text-fg placeholder:text-fg-subtle " +
  "focus:border-line-strong focus:bg-surface-2";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input className={cn(fieldSurface, fieldText, "h-8 w-full px-3", className)} {...props} />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldSurface, fieldText, "min-h-16 w-full resize-none px-3 py-2", className)}
      {...props}
    />
  );
}

export { Input, Textarea, fieldSurface };
