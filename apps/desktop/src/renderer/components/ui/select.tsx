import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { popupClasses, itemClasses } from "./menu";

const Select = BaseSelect.Root;
const SelectValue = BaseSelect.Value;
const SelectGroup = BaseSelect.Group;

// The trigger is the popup's closed form: same raised surface language as a
// secondary button, so closed and open states read as one object.
function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "pressable flex h-8 min-w-36 select-none items-center justify-between gap-2 rounded-md border border-line bg-surface-2 pl-3 pr-2.5 text-label-md text-fg shadow-raised",
        "hover:border-line-strong hover:bg-surface-3 data-[popup-open]:border-line-strong data-[popup-open]:bg-surface-3",
        "data-[disabled]:pointer-events-none [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="flex shrink-0 text-fg-subtle transition-transform duration-200 ease-(--ease-standard) in-data-[popup-open]:rotate-180">
        <CaretDownIcon size={12} weight="bold" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

function SelectContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        className="z-50 outline-none"
        sideOffset={6}
        alignItemWithTrigger={false}
      >
        <BaseSelect.Popup
          className={cn(
            popupClasses,
            "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto",
            className,
          )}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item className={cn(itemClasses, "relative pr-8", className)} {...props}>
      <BaseSelect.ItemText className="min-w-0 truncate">{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="absolute right-2.5 flex">
        <CheckIcon size={14} weight="bold" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.GroupLabel>) {
  return (
    <BaseSelect.GroupLabel
      className={cn("px-2.5 py-1.5 text-label-sm text-fg-subtle", className)}
      {...props}
    />
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.Separator>) {
  return (
    <BaseSelect.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} {...props} />
  );
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
};
