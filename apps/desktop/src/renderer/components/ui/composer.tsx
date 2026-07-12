import * as React from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";

interface ComposerProps
  extends Omit<React.ComponentProps<"textarea">, "onSubmit" | "rows"> {
  onSubmit?: (value: string) => void;
  // Slots flanking the textarea — attach/context buttons on the left,
  // extra actions (model picker, mic) between textarea and send.
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  submitDisabled?: boolean;
  /** Escape hatch to the inner textarea (e.g. refocus after a picker inserts text). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

// The pill composer — the hero of the chat screen. Floats above the canvas
// (shadow-float), reads as a full pill at one line, and grows to a soft
// rounded card as the draft gets taller. Enter sends, Shift+Enter breaks.
function Composer({
  className,
  onSubmit,
  leading,
  actions,
  submitDisabled = false,
  value: valueProp,
  defaultValue,
  onChange,
  onKeyDown,
  disabled,
  placeholder = "Ask anything…",
  textareaRef: externalTextareaRef,
  ...props
}: ComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(externalTextareaRef, () => textareaRef.current!, []);
  const [innerValue, setInnerValue] = React.useState(defaultValue?.toString() ?? "");
  const isControlled = valueProp !== undefined;
  const value = isControlled ? String(valueProp) : innerValue;
  const canSubmit = !disabled && !submitDisabled && value.trim().length > 0;

  // Grow with content up to ~7 lines, then scroll inside.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit?.(value.trim());
    if (!isControlled) setInnerValue("");
  };

  return (
    <div
      className={cn(
        "flex items-end gap-1 rounded-[26px] border border-line bg-surface-1 p-2 shadow-float transition-[border-color,box-shadow] duration-300 ease-(--ease-standard) focus-within:border-line-strong focus-within:shadow-glow",
        className,
      )}
    >
      {leading}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          if (!isControlled) setInnerValue(event.target.value);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-48 min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-1.5 text-body-md text-fg outline-none placeholder:text-fg-subtle"
        {...props}
      />
      {actions}
      <button
        type="button"
        aria-label="Send"
        disabled={!canSubmit}
        onClick={submit}
        className="pressable flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg shadow-raised hover:bg-primary-hover active:bg-primary-active"
      >
        <ArrowUpIcon size={18} weight="bold" />
      </button>
    </div>
  );
}

// Round ghost icon button sized for the composer's slots. Holds its hover
// tone while a menu it triggers is open (Base UI sets data-popup-open).
function ComposerButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn(
        "rounded-full data-[popup-open]:bg-surface-3 data-[popup-open]:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export { Composer, ComposerButton, type ComposerProps };
