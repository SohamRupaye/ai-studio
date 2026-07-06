import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "../../lib/utils";

// Raised chip in the theme's own surface language (an inverted fg-on-canvas
// version read as broken theming). Wrap clusters of tooltipped controls in
// TooltipProvider so moving between them skips the open delay.
const TooltipProvider = BaseTooltip.Provider;
const Tooltip = BaseTooltip.Root;
const TooltipTrigger = BaseTooltip.Trigger;

interface TooltipContentProps extends React.ComponentProps<typeof BaseTooltip.Popup> {
  side?: React.ComponentProps<typeof BaseTooltip.Positioner>["side"];
  sideOffset?: number;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  ...props
}: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="z-50">
        <BaseTooltip.Popup
          className={cn(
            "origin-(--transform-origin) select-none rounded-sm border border-line bg-surface-3 px-2 py-1 text-label-sm text-fg shadow-md",
            "transition-[transform,opacity] duration-150 ease-(--ease-standard)",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-100",
            className,
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
