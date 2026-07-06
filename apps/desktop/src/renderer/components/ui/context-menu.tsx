import * as React from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui-components/react/context-menu";
import { CheckIcon, CaretRightIcon, CircleIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { popupClasses, itemClasses } from "./menu";

const ContextMenu = BaseContextMenu.Root;
const ContextMenuTrigger = BaseContextMenu.Trigger;
const ContextMenuGroup = BaseContextMenu.Group;
const ContextMenuRadioGroup = BaseContextMenu.RadioGroup;
const ContextMenuSub = BaseContextMenu.SubmenuRoot;

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.Popup>) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner className="z-50 max-h-(--available-height) outline-none">
        <BaseContextMenu.Popup className={cn(popupClasses, className)} {...props} />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.Item>) {
  return <BaseContextMenu.Item className={cn(itemClasses, className)} {...props} />;
}

function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.CheckboxItem>) {
  return (
    <BaseContextMenu.CheckboxItem className={cn(itemClasses, "pl-8", className)} {...props}>
      <BaseContextMenu.CheckboxItemIndicator className="absolute left-2.5">
        <CheckIcon size={14} weight="bold" />
      </BaseContextMenu.CheckboxItemIndicator>
      {children}
    </BaseContextMenu.CheckboxItem>
  );
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.RadioItem>) {
  return (
    <BaseContextMenu.RadioItem className={cn(itemClasses, "pl-8", className)} {...props}>
      <BaseContextMenu.RadioItemIndicator className="absolute left-3">
        <CircleIcon size={8} weight="fill" />
      </BaseContextMenu.RadioItemIndicator>
      {children}
    </BaseContextMenu.RadioItem>
  );
}

function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.GroupLabel>) {
  return (
    <BaseContextMenu.GroupLabel
      className={cn("px-2.5 py-1.5 text-label-sm text-fg-subtle", className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.Separator>) {
  return (
    <BaseContextMenu.Separator
      className={cn("-mx-1.5 my-1.5 h-px bg-line", className)}
      {...props}
    />
  );
}

// Right-aligned hint inside an item — shortcut text, never focusable.
function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("ml-auto pl-6 text-label-sm text-fg-subtle", className)} {...props} />
  );
}

function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.SubmenuTrigger>) {
  return (
    <BaseContextMenu.SubmenuTrigger
      className={cn(itemClasses, "data-[popup-open]:bg-surface-3", className)}
      {...props}
    >
      {children}
      <CaretRightIcon size={14} className="ml-auto" />
    </BaseContextMenu.SubmenuTrigger>
  );
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseContextMenu.Popup>) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        className="z-50 max-h-(--available-height) outline-none"
        sideOffset={4}
      >
        <BaseContextMenu.Popup className={cn(popupClasses, className)} {...props} />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuRadioGroup,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
};
