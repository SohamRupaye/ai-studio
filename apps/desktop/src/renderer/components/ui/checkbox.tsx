import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "pressable flex size-4.5 shrink-0 items-center justify-center rounded-xs border border-line-strong bg-surface-1 shadow-raised",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator
        keepMounted
        className={cn(
          "flex scale-0 text-primary-fg transition-transform duration-200 ease-(--ease-spring)",
          "data-[checked]:scale-100 data-[indeterminate]:scale-100",
        )}
      >
        {props.indeterminate ? (
          <MinusIcon size={12} weight="bold" />
        ) : (
          <CheckIcon size={12} weight="bold" />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export { Checkbox };
