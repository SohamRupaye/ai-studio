import { CaretRightIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Shared page primitives
// ─────────────────────────────────────────────────────────────────────────────

export function ScopeHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <header>
      <h2 className="text-heading-md text-fg">{title}</h2>
      <p className="mt-1 text-body-md text-fg-muted">{hint}</p>
    </header>
  );
}

/** Label + hint on the left, the control on the right — settings grammar. */
export function FieldRow({
  label,
  hint,
  htmlFor,
  align = "center",
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  /** "start" for tall controls like textareas. */
  align?: "center" | "start";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-10 py-4",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-label-md text-fg">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-body-sm text-fg-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  /** Right-aligned action cluster on the section's title row — section-level
   * operations belong at the top, not below a scrolling list. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-label-lg text-fg">{title}</h3>
          {hint && <p className="mt-0.5 text-body-sm text-fg-muted">{hint}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingsRow({
  icon: IconComponent,
  title,
  description,
  onClick,
  danger,
}: {
  icon: Icon;
  title: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable flex w-full items-center gap-3.5 px-4 py-3.5 text-left",
        danger ? "hover:bg-danger-soft" : "hover:bg-surface-2",
      )}
    >
      <IconComponent
        size={18}
        className={cn("shrink-0", danger ? "text-danger-text" : "text-fg-subtle")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-label-md", danger ? "text-danger-text" : "text-fg")}>
          {title}
        </span>
        <span className="mt-0.5 block text-body-sm text-fg-muted">{description}</span>
      </span>
      <CaretRightIcon
        size={14}
        className={cn("shrink-0", danger ? "text-danger-text" : "text-fg-subtle")}
      />
    </button>
  );
}
