import { Toaster as SonnerToaster } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

const Toaster = ({ ...props }: ToasterProps) => (
  <SonnerToaster
    theme="dark"
    className="toaster group"
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg group-[.toaster]:font-sans",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md group-[.toast]:font-mono group-[.toast]:text-xs",
        cancelButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-md group-[.toast]:font-mono group-[.toast]:text-xs",
        success: "group-[.toaster]:border-success/40 group-[.toaster]:text-success",
        error:   "group-[.toaster]:border-destructive/40 group-[.toaster]:text-destructive",
        warning: "group-[.toaster]:border-warning/40 group-[.toaster]:text-warning",
        info:    "group-[.toaster]:border-primary/40",
      },
    }}
    {...props}
  />
);

export { Toaster };
export { toast } from "sonner";
