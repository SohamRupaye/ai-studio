import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "../../lib/utils";

// Track sinks (off) and fills with primary (on); the thumb springs across.
function Switch({ className, ...props }: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "pressable inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border border-line bg-sunken p-0.5 shadow-sunken",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:shadow-none",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "size-3.5 rounded-full bg-fg-muted shadow-raised transition-transform duration-200 ease-(--ease-spring)",
          "data-[checked]:translate-x-3.5 data-[checked]:bg-primary-fg",
        )}
      />
    </BaseSwitch.Root>
  );
}

export { Switch };
