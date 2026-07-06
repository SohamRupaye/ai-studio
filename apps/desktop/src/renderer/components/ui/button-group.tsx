import * as React from "react";
import { Toggle } from "@base-ui-components/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui-components/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import { buttonSizes } from "./button";

// Joined segmented group — children lose their own radius, borders collapse
// via -ml-px. Two modes:
//   - Plain (no value props): action cluster of secondary/ghost Buttons;
//     keep primary out of groups.
//   - Selectable (value/defaultValue/onValueChange): single-select segmented
//     control (Base UI ToggleGroup — arrow keys, aria-pressed). Children are
//     ButtonGroupItems. Once something is selected it stays selected —
//     re-clicking the pressed segment is ignored; add a prop if a page ever
//     needs deselect-to-empty.
const groupClasses = cn(
  "inline-flex items-center",
  "[&>*]:relative [&>*]:rounded-none [&>*:not(:first-child)]:-ml-px",
  "[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md",
);

interface ButtonGroupProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
}

function ButtonGroup({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: ButtonGroupProps) {
  const selectable =
    value !== undefined || defaultValue !== undefined || onValueChange !== undefined;
  const [innerValue, setInnerValue] = React.useState<string | null>(defaultValue ?? null);
  const currentValue = value !== undefined ? value : innerValue;

  if (!selectable) {
    return <div role="group" className={cn(groupClasses, className)} {...props} />;
  }

  return (
    <BaseToggleGroup
      value={currentValue === null ? [] : [currentValue]}
      onValueChange={(groupValue) => {
        const next = (groupValue[0] as string | undefined) ?? null;
        if (next === null) return;
        if (value === undefined) setInnerValue(next);
        onValueChange?.(next);
      }}
      className={cn(groupClasses, className)}
      {...props}
    />
  );
}

// Segment of a selectable ButtonGroup. Selection walks the elevation ramp,
// same language as the tabs indicator: rest surface-1 → hover surface-2 →
// pressed surface-3 + shadow-raised (raised = selected). Pressed segment gets
// z-[1] so its stronger border wins over the -ml-px overlap.
const buttonGroupItemVariants = cva(
  cn(
    "pressable inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap border border-line bg-surface-1 text-fg-muted focus-visible:z-10 [&_svg]:shrink-0",
    "[&:not([data-pressed]):hover]:bg-surface-2 [&:not([data-pressed]):hover]:text-fg",
    "data-[pressed]:z-[1] data-[pressed]:border-line-strong data-[pressed]:bg-surface-3 data-[pressed]:text-fg data-[pressed]:shadow-raised",
  ),
  {
    variants: {
      size: buttonSizes,
    },
    defaultVariants: {
      size: "md",
    },
  },
);

interface ButtonGroupItemProps
  extends React.ComponentProps<typeof Toggle>,
    VariantProps<typeof buttonGroupItemVariants> {}

function ButtonGroupItem({ className, size, ...props }: ButtonGroupItemProps) {
  return <Toggle className={cn(buttonGroupItemVariants({ size }), className)} {...props} />;
}

export { ButtonGroup, ButtonGroupItem };
