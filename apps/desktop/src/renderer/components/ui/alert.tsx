import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  InfoIcon,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

const alertVariants = cva("flex gap-3 rounded-lg border p-4 text-body-md", {
  variants: {
    variant: {
      neutral: "border-line bg-surface-1 text-fg [&>svg]:text-fg-muted",
      info: "border-info-line bg-info-soft text-fg [&>svg]:text-info",
      success: "border-success/25 bg-success-soft text-fg [&>svg]:text-success",
      warning: "border-warning/25 bg-warning-soft text-fg [&>svg]:text-warning",
      danger: "border-danger/25 bg-danger-soft text-fg [&>svg]:text-danger",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

const defaultIcons = {
  neutral: InfoIcon,
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: XCircleIcon,
} as const;

interface AlertProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof alertVariants> {
  // Pass a custom Phosphor icon, or `icon={null}` to omit it.
  icon?: React.ReactNode;
}

function Alert({ className, variant, icon, children, ...props }: AlertProps) {
  const DefaultIcon = defaultIcons[variant ?? "neutral"];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {icon === undefined ? <DefaultIcon size={18} weight="fill" className="mt-0.5 shrink-0" /> : icon}
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("text-label-lg text-fg", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("text-body-sm text-fg-muted", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
