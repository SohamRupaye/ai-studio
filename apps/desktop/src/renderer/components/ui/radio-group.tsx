import * as React from "react";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import { Radio as BaseRadio } from "@base-ui-components/react/radio";
import { cn } from "../../lib/utils";

function RadioGroup({ className, ...props }: React.ComponentProps<typeof BaseRadioGroup>) {
  return <BaseRadioGroup className={cn("flex flex-col gap-2.5", className)} {...props} />;
}

function Radio({ className, ...props }: React.ComponentProps<typeof BaseRadio.Root>) {
  return (
    <BaseRadio.Root
      className={cn(
        "pressable flex size-4.5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-1 shadow-raised",
        "data-[checked]:border-primary data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <BaseRadio.Indicator
        keepMounted
        className={cn(
          "size-1.5 scale-0 rounded-full bg-primary-fg transition-transform duration-200 ease-(--ease-spring)",
          "data-[checked]:scale-100",
        )}
      />
    </BaseRadio.Root>
  );
}

export { RadioGroup, Radio };
