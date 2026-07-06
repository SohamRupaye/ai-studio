import * as React from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

const Drawer = Dialog.Root;
const DrawerTrigger = Dialog.Trigger;
const DrawerClose = Dialog.Close;

// Floating card, not an edge-glued sheet: inset from the window edge, full
// radius, slides in decelerating / out accelerating (keyframes in globals.css).
const sideClasses = {
  right:
    "inset-y-3 right-3 w-100 max-w-[calc(100vw-24px)] data-[open]:animate-slide-in-right data-[closed]:animate-slide-out-right",
  left: "inset-y-3 left-3 w-100 max-w-[calc(100vw-24px)] data-[open]:animate-slide-in-left data-[closed]:animate-slide-out-left",
  bottom:
    "inset-x-3 bottom-3 max-h-[85vh] data-[open]:animate-slide-in-bottom data-[closed]:animate-slide-out-bottom",
} as const;

interface DrawerContentProps extends React.ComponentProps<typeof Dialog.Popup> {
  side?: keyof typeof sideClasses;
  showClose?: boolean;
}

function DrawerContent({
  side = "right",
  showClose = true,
  className,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[open]:animate-fade-in data-[closed]:animate-fade-out" />
      <Dialog.Popup
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-xl outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <Dialog.Close
            aria-label="Close"
            className="pressable absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          >
            <XIcon size={16} />
          </Dialog.Close>
        )}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-4", className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("text-heading-sm text-fg", className)} {...props} />;
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      className={cn("text-body-sm text-fg-muted", className)}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-5", className)} {...props} />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 p-5 pt-4", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
};
