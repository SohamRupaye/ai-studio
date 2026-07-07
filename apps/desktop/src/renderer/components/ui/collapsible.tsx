import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui-components/react/collapsible";
import { CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

// For thinking blocks and tool-call activity in chat: a quiet trigger row
// whose caret rotates, and a panel that animates open to its content height.
const Collapsible = BaseCollapsible.Root;

function CollapsibleTrigger({
  className,
  children,
  caret = true,
  ...props
}: React.ComponentProps<typeof BaseCollapsible.Trigger> & {
  /**
   * Set false to omit the built-in leading caret and place your own inside
   * children (style it with `group-data-[panel-open]/collapsible:rotate-90`)
   * — for rows whose caret belongs at the trailing edge.
   */
  caret?: boolean;
}) {
  return (
    <BaseCollapsible.Trigger
      className={cn(
        "group/collapsible flex select-none items-center gap-1.5 rounded-md text-body-sm text-fg-muted hover:text-fg",
        className,
      )}
      {...props}
    >
      {caret && (
        <CaretRightIcon
          size={12}
          weight="bold"
          className="shrink-0 text-fg-subtle transition-transform duration-200 ease-(--ease-standard) group-data-[panel-open]/collapsible:rotate-90"
        />
      )}
      {children}
    </BaseCollapsible.Trigger>
  );
}

function CollapsiblePanel({
  className,
  ...props
}: React.ComponentProps<typeof BaseCollapsible.Panel>) {
  return (
    <BaseCollapsible.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden",
        "transition-[height] duration-200 ease-(--ease-standard)",
        "data-[starting-style]:h-0 data-[ending-style]:h-0",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
