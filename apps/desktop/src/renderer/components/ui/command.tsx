import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog } from "@base-ui-components/react/dialog";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

// Command bar: cmdk for filtering/keyboard model, Base UI Dialog for the
// overlay. Item radius follows the nesting rule against the list padding.
function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn("flex size-full flex-col overflow-hidden outline-none", className)}
      {...props}
    />
  );
}

interface CommandDialogProps extends React.ComponentProps<typeof CommandPrimitive> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CommandDialog({ open, onOpenChange, children, ...props }: CommandDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[open]:animate-fade-in data-[closed]:animate-fade-out" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-[22%] z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden",
            "rounded-xl border border-line bg-surface-2 shadow-xl outline-none",
            "data-[open]:animate-pop data-[closed]:animate-fade-out",
          )}
          aria-label="Command bar"
        >
          <Command {...props}>{children}</Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4">
      <MagnifyingGlassIcon size={16} className="shrink-0 text-fg-subtle" />
      <CommandPrimitive.Input
        className={cn(
          "h-12 min-w-0 flex-1 bg-transparent text-body-md text-fg outline-none placeholder:text-fg-subtle",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-80 overflow-y-auto overscroll-contain p-1.5", className)}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("py-8 text-center text-body-sm text-fg-muted", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label-sm [&_[cmdk-group-heading]]:text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-label-md text-fg outline-none",
        "data-[selected=true]:bg-surface-3 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("-mx-1.5 my-1.5 h-px bg-line", className)}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("ml-auto flex items-center pl-6 text-label-sm text-fg-subtle", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
