import * as React from "react";
import { cn } from "../../lib/utils";

// Inline chat-timeline marker: a quiet icon + text row for events between
// turns ("Switched to a new branch", "Thinking…", "Explored 4 files").
// `rule` centers the content between hairlines ("Conversation compacted").
interface MarkerProps extends React.ComponentProps<"div"> {
  rule?: boolean;
}

function Marker({ className, rule = false, children, ...props }: MarkerProps) {
  if (rule) {
    return (
      <div
        className={cn("flex items-center gap-4 text-body-sm text-fg-subtle", className)}
        {...props}
      >
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="flex min-w-0 items-center gap-2.5">{children}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return (
    <div
      className={cn("flex items-center gap-2.5 text-body-sm text-fg-muted", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("flex shrink-0 text-fg-subtle [&_svg]:size-4", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("min-w-0", className)} {...props} />;
}

export { Marker, MarkerIcon, MarkerContent };
