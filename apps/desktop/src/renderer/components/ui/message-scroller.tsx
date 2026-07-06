import * as React from "react";
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";

// Chat scroll container (@shadcn/react primitive under our styling): anchors
// the latest turn, follows streamed output while the user is at the bottom,
// preserves position when history is prepended, and exposes jump-to-message
// via useMessageScroller().scrollToMessage(id). Wrap a chat in Provider →
// Root → Viewport → Content → Item(messageId).
const MessageScrollerProvider = MessageScrollerPrimitive.Provider;

function MessageScroller({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <MessageScrollerPrimitive.Root
      className={cn("relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  preserveScrollOnPrepend = true,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      preserveScrollOnPrepend={preserveScrollOnPrepend}
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      className={cn("flex h-max min-h-full flex-col gap-6", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className,
      )}
      {...props}
    />
  );
}

// Floating jump-to-latest pill; slides away while the user is at the edge.
function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<ButtonProps, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      direction={direction}
      className={cn(
        "absolute left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md transition-[translate,scale,opacity] duration-200 ease-(--ease-standard)",
        "data-[active=false]:pointer-events-none data-[active=false]:scale-90 data-[active=false]:opacity-0",
        direction === "end"
          ? "bottom-3 data-[active=false]:translate-y-2"
          : "top-3 data-[active=false]:-translate-y-2 [&_svg]:rotate-180",
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon size={16} />
          <span className="sr-only">
            {direction === "end" ? "Scroll to latest" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
