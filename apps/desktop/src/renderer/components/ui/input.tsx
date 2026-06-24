import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  [
    "flex h-9 w-full rounded-md border bg-transparent px-3 py-1",
    "text-sm text-foreground placeholder:text-muted-foreground",
    "transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
  ],
  {
    variants: {
      variant: {
        default:  "border-input focus-visible:ring-ring",
        error:    "border-destructive focus-visible:ring-destructive",
        success:  "border-success focus-visible:ring-success",
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
