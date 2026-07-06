import * as React from "react";
import { Slider as BaseSlider } from "@base-ui-components/react/slider";
import { cn } from "../../lib/utils";

// For model params (temperature, top-p). showValue prints the number in mono
// (numbers are data) — pass `format` for units.
interface SliderProps extends React.ComponentProps<typeof BaseSlider.Root> {
  showValue?: boolean;
}

function Slider({ className, showValue = false, ...props }: SliderProps) {
  return (
    <BaseSlider.Root
      className={cn("flex w-full items-center gap-3", className)}
      {...props}
    >
      <BaseSlider.Control className="flex w-full touch-none select-none items-center py-1.5">
        <BaseSlider.Track className="relative h-1 w-full rounded-full bg-surface-3">
          <BaseSlider.Indicator className="rounded-full bg-primary" />
          <BaseSlider.Thumb
            className={cn(
              "size-4 rounded-full border border-line-strong bg-primary shadow-raised",
              "transition-transform duration-100 ease-(--ease-spring)",
              "hover:scale-110 data-[dragging]:scale-125",
            )}
            aria-label="Value"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
      {showValue && (
        <BaseSlider.Value className="w-10 shrink-0 text-right font-mono text-[11px] text-fg-muted" />
      )}
    </BaseSlider.Root>
  );
}

export { Slider };
