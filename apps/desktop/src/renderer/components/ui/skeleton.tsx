import * as React from "react";
import { cn } from "../../lib/utils";

// Shape comes from className (w/h/rounded); the `skeleton` utility supplies
// the warm surface + opacity pulse.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton", className)} {...props} />;
}

export { Skeleton };
