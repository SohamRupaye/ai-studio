import * as React from "react";
import { Toaster as SonnerToaster, toast, type ToasterProps } from "sonner";

// Sonner, restyled onto the warm-mono tokens (unstyled + classNames so no
// stock sonner look leaks through). Mount once at app level; fire with toast().
function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={16}
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-89 items-center gap-3 rounded-lg border border-line bg-surface-2 p-4 shadow-lg animate-rise",
          title: "text-label-lg text-fg",
          description: "text-body-sm text-fg-muted",
          icon: "shrink-0 [&_svg]:size-4.5",
          success: "[&>[data-icon]]:text-success",
          error: "[&>[data-icon]]:text-danger",
          warning: "[&>[data-icon]]:text-warning",
          info: "[&>[data-icon]]:text-info",
          actionButton:
            "pressable ml-auto h-7 shrink-0 rounded-md bg-primary px-2.5 text-label-sm text-primary-fg",
          cancelButton:
            "pressable ml-auto h-7 shrink-0 rounded-md border border-line bg-surface-2 px-2.5 text-label-sm text-fg-muted",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
