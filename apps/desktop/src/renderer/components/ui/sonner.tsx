import { Toaster as SonnerToaster } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

// Styled via inline tokens (not classNames) so it always beats Sonner's own
// stylesheet and flips automatically with .dark — no hardcoded theme.
const Toaster = ({ ...props }: ToasterProps) => (
  <SonnerToaster
    position="bottom-right"
    offset={20}
    gap={8}
    duration={3200}
    toastOptions={{
      style: {
        background: "hsl(var(--popover))",
        color: "hsl(var(--popover-foreground))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "12px",
        boxShadow: "var(--shadow-lg)",
        padding: "12px 14px",
        fontSize: "13px",
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
      },
      classNames: {
        description: "!text-muted-foreground !font-normal",
        success: "[&_[data-icon]]:!text-success",
        error: "[&_[data-icon]]:!text-destructive",
        warning: "[&_[data-icon]]:!text-warning",
        info: "[&_[data-icon]]:!text-primary",
        actionButton: "!bg-primary !text-primary-foreground !rounded-lg !text-xs !font-medium",
        cancelButton: "!bg-muted !text-muted-foreground !rounded-lg !text-xs !font-medium",
      },
    }}
    {...props}
  />
);

export { Toaster };
export { toast } from "sonner";
