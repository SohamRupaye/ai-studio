import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  [
    "flex h-8 w-full rounded-lg border bg-canvas px-3 py-1",
    "text-[13px] text-foreground shadow-xs placeholder:text-muted-foreground/70",
    "transition-[border-color,box-shadow] duration-150",
    "focus-visible:outline-none focus-visible:ring-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
  ],
  {
    variants: {
      variant: {
        default:  "border-input focus-visible:border-ring focus-visible:ring-ring/25",
        error:    "border-destructive focus-visible:ring-destructive/25",
        success:  "border-success focus-visible:ring-success/25",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

type InputProps = InputHTMLAttributes<HTMLInputElement> & VariantProps<typeof inputVariants>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
