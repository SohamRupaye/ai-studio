import * as React from "react";
import { Avatar as BaseAvatar } from "@base-ui-components/react/avatar";
import { cn } from "../../lib/utils";

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-label-sm",
  lg: "size-10 text-label-md",
} as const;

interface AvatarProps extends React.ComponentProps<typeof BaseAvatar.Root> {
  size?: keyof typeof sizes;
  src?: string;
  alt?: string;
  // Fallback initials shown while loading or when src is missing/broken.
  fallback?: React.ReactNode;
}

function Avatar({ className, size = "md", src, alt, fallback, ...props }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "relative flex shrink-0 select-none overflow-hidden rounded-full bg-surface-3",
        sizes[size],
        className,
      )}
      {...props}
    >
      {src && <BaseAvatar.Image src={src} alt={alt} className="size-full object-cover" />}
      <BaseAvatar.Fallback className="flex size-full items-center justify-center font-medium text-fg-muted uppercase">
        {fallback}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

export { Avatar };
