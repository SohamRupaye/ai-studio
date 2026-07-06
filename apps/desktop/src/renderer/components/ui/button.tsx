import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Minimal asChild slot — merges button styling onto the child element
// (e.g. a router <Link>). Refs pass through via React 19 ref-as-prop.
function Slot({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  if (!React.isValidElement(children)) return null;
  const childProps = children.props as { className?: string };
  return React.cloneElement(children, {
    ...props,
    className: cn(className, childProps.className),
  } as Partial<unknown>);
}

// Shared with ButtonGroupItem so segment sizes can't drift from button sizes.
const buttonSizes = {
  sm: "h-7 px-2.5 text-label-sm",
  md: "h-8 px-3 text-label-md",
  lg: "h-10 px-4 text-label-lg",
  "icon-sm": "size-7",
  icon: "size-8",
  "icon-lg": "size-10",
};

// `primary` is the hero action — one per screen. Everything else defaults to
// `secondary` so the hierarchy holds without anyone thinking about it.
const buttonVariants = cva(
  "pressable inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md focus-visible:z-10 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-fg shadow-raised hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-line bg-surface-2 text-fg shadow-raised hover:bg-surface-3 hover:border-line-strong",
        outline:
          "border border-line bg-transparent text-fg hover:bg-surface-2 hover:border-line-strong",
        ghost: "text-fg-muted hover:bg-surface-3 hover:text-fg",
        danger: "bg-danger text-white shadow-raised hover:opacity-90",
      },
      size: buttonSizes,
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants, buttonSizes, type ButtonProps };
