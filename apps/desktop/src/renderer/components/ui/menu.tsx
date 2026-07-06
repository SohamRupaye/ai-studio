import * as React from "react";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { CheckIcon, CaretRightIcon, CircleIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

// Shared popup/item styling for all menu-shaped surfaces (dropdown menu,
// context menu). Popup 16px radius − 6px padding = 10px item radius.
const popupClasses =
  "min-w-44 origin-(--transform-origin) rounded-lg border border-line bg-surface-2 p-1.5 shadow-float " +
  "transition-[transform,opacity] duration-200 ease-(--ease-spring) " +
  "data-[starting-style]:scale-95 data-[starting-style]:opacity-0 " +
  "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[ending-style]:ease-(--ease-accel)";

const itemClasses =
  "flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-label-md text-fg outline-none " +
  "data-[highlighted]:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

const Menu = BaseMenu.Root;
const MenuTrigger = BaseMenu.Trigger;
const MenuGroup = BaseMenu.Group;
const MenuRadioGroup = BaseMenu.RadioGroup;
const MenuSub = BaseMenu.SubmenuRoot;

interface MenuContentProps extends React.ComponentProps<typeof BaseMenu.Popup> {
  side?: React.ComponentProps<typeof BaseMenu.Positioner>["side"];
  align?: React.ComponentProps<typeof BaseMenu.Positioner>["align"];
  sideOffset?: number;
}

function MenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  ...props
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50 max-h-(--available-height) outline-none"
      >
        <BaseMenu.Popup className={cn(popupClasses, className)} {...props} />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

function MenuItem({ className, ...props }: React.ComponentProps<typeof BaseMenu.Item>) {
  return <BaseMenu.Item className={cn(itemClasses, className)} {...props} />;
}

function MenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem className={cn(itemClasses, "pl-8", className)} {...props}>
      <BaseMenu.CheckboxItemIndicator className="absolute left-2.5">
        <CheckIcon size={14} weight="bold" />
      </BaseMenu.CheckboxItemIndicator>
      {children}
    </BaseMenu.CheckboxItem>
  );
}

function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem className={cn(itemClasses, "pl-8", className)} {...props}>
      <BaseMenu.RadioItemIndicator className="absolute left-3">
        <CircleIcon size={8} weight="fill" />
      </BaseMenu.RadioItemIndicator>
      {children}
    </BaseMenu.RadioItem>
  );
}

function MenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      className={cn("px-2.5 py-1.5 text-label-sm text-fg-subtle", className)}
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.Separator>) {
  return (
    <BaseMenu.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} {...props} />
  );
}

// Right-aligned hint inside an item — shortcut text or keycaps.
function MenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("ml-auto flex items-center pl-6 text-label-sm text-fg-subtle", className)}
      {...props}
    />
  );
}

function MenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.SubmenuTrigger>) {
  return (
    <BaseMenu.SubmenuTrigger
      className={cn(itemClasses, "data-[popup-open]:bg-surface-3", className)}
      {...props}
    >
      {children}
      <CaretRightIcon size={14} className="ml-auto" />
    </BaseMenu.SubmenuTrigger>
  );
}

function MenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className="z-50 max-h-(--available-height) outline-none"
        sideOffset={4}
      >
        <BaseMenu.Popup className={cn(popupClasses, className)} {...props} />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioItem,
  MenuRadioGroup,
  MenuGroup,
  MenuLabel,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
  popupClasses,
  itemClasses,
};
