import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Heading, Text } from "./ui/typography";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// PageContainer — consistent scroll + max-width wrapper for a page
// ─────────────────────────────────────────────────────────────────────────────

export function PageContainer({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div
        className={cn(
          "mx-auto w-full px-10 py-9",
          wide ? "max-w-6xl" : "max-w-3xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PageHeader — title, description, optional action slot
// ─────────────────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <Text size="sm" variant="muted" as="span" className="mb-1 block">
            {eyebrow}
          </Text>
        )}
        <Heading size="h2" className="truncate">
          {title}
        </Heading>
        {description && (
          <Text size="sm" variant="muted" className="mt-1.5">
            {description}
          </Text>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState — for empty lists
// ─────────────────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="max-w-sm">
        <Heading size="h4" as="div">
          {title}
        </Heading>
        {description && (
          <Text size="sm" variant="muted" className="mt-1">
            {description}
          </Text>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatCard — metric display for dashboards.
// The number is the hero; icon and accent stay quiet so four cards in a row
// don't read as a rainbow.
// ─────────────────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  accent: _accent = "primary",
}: {
  label: string;
  value: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  accent?: "primary" | "highlight" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/50" />}
      </div>
      <div>
        <div className="font-h2 tabular-nums text-foreground">{value}</div>
        {hint && (
          <Text size="xs" variant="subtle" className="mt-0.5">
            {hint}
          </Text>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LoadingState / ErrorState
// ─────────────────────────────────────────────────────────────────────────────

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <Text size="sm" variant="muted">
          {label}
        </Text>
      </div>
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
          <AlertCircle className="h-5 w-5 text-destructive" />
        </div>
        <Heading size="h4" as="div">
          Something went wrong
        </Heading>
        <Text size="sm" variant="muted">
          {error.message}
        </Text>
      </div>
    </div>
  );
}
