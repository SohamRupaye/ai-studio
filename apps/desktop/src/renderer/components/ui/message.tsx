import * as React from "react";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

// Chat message with a hover-revealed action row. Composable so the chat page
// wires real handlers:
//   <Message role="assistant">
//     <MessageContent>…</MessageContent>
//     <MessageActions>
//       <MessageAction label="Copy" onClick={…}><CopyIcon /></MessageAction>
//       <MessageTimestamp>14:32</MessageTimestamp>
//       <MessageModel>claude-fable-5</MessageModel>
//     </MessageActions>
//   </Message>
interface MessageProps extends React.ComponentProps<"div"> {
  role: "user" | "assistant";
}

function Message({ role, className, ...props }: MessageProps) {
  return (
    <div
      data-role={role}
      className={cn(
        "group/message flex min-w-0 flex-col gap-1",
        role === "user" ? "items-end" : "items-start",
        className,
      )}
      {...props}
    />
  );
}

// User turns get the bubble; assistant turns read as document text.
function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-[85%] text-body-md text-fg",
        "in-data-[role=user]:rounded-lg in-data-[role=user]:rounded-br-sm in-data-[role=user]:bg-surface-3 in-data-[role=user]:px-3.5 in-data-[role=user]:py-2",
        className,
      )}
      {...props}
    />
  );
}

// Ghost row under the content — invisible until the message is hovered or an
// action inside it has keyboard focus, like most chat apps. The shared
// TooltipProvider lets tooltips open instantly when sweeping across the row.
function MessageActions({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity duration-200",
        "group-hover/message:opacity-100 group-focus-within/message:opacity-100",
        className,
      )}
      {...props}
    >
      <TooltipProvider delay={400} closeDelay={0}>{children}</TooltipProvider>
    </div>
  );
}

interface MessageActionProps extends ButtonProps {
  label: string;
}

function MessageAction({ label, className, children, ...props }: MessageActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn("text-fg-subtle hover:text-fg [&_svg]:size-3.5", className)}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MessageTimestamp({ className, ...props }: React.ComponentProps<"time">) {
  return (
    <time
      className={cn("px-1.5 text-label-sm text-fg-subtle select-none", className)}
      {...props}
    />
  );
}

// Model name is data → mono, per the type rules.
function MessageModel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("px-1.5 font-mono text-[11px] text-fg-subtle select-none", className)}
      {...props}
    />
  );
}

export {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageTimestamp,
  MessageModel,
};
