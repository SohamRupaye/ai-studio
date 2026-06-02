import { useState, type ReactNode, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TooltipProps extends HTMLAttributes<HTMLDivElement> {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, side = "top", className, ...props }: TooltipProps) {
  const [show, setShow] = useState(false);
  const positions = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      {...props}
    >
      {children}
      {show && (
        <div className={cn("absolute z-50 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md animate-in fade-in-0", positions[side])}>
          {content}
        </div>
      )}
    </div>
  );
}
