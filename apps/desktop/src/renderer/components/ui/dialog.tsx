import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

// Centered modal — the drawer's sibling (same Base UI Dialog underneath).
// Use for confirmations and focused forms; use Drawer for reference panels.
const Dialog = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;
const DialogClose = BaseDialog.Close;

interface DialogContentProps extends React.ComponentProps<typeof BaseDialog.Popup> {
  showClose?: boolean;
}

function DialogContent({ showClose = true, className, children, ...props }: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[open]:animate-fade-in data-[closed]:animate-fade-out" />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
          "flex max-h-[85vh] flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-xl outline-none",
          "data-[open]:animate-pop data-[closed]:animate-fade-out",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <BaseDialog.Close
            aria-label="Close"
            className="pressable absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          >
            <XIcon size={16} />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn("text-heading-sm text-fg", className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description className={cn("text-body-sm text-fg-muted", className)} {...props} />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center justify-end gap-2 p-5 pt-4", className)} {...props} />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
};
