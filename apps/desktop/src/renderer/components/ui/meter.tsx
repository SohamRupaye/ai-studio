import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

// Capacity meters (context-window fill, quotas), linear and radial. Fill
// color is state: calm until 75%, warning to 90%, danger beyond. The value
// always travels as text beside/inside the meter — color never carries it
// alone. Linear track speaks the switch track's sunken language; the ring's
// track is a recessive hairline circle.
export function Meter({
  value,
  max,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  max: number;
  className?: string;
  "aria-label"?: string;
}) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const tone = ratio >= 0.9 ? "bg-danger" : ratio >= 0.75 ? "bg-warning" : "bg-primary";
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken shadow-sunken", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-(--ease-decel)", tone)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

// Radial variant — a donut gauge. Children render centered in the hole
// (put the % there, in mono text tokens).
export function MeterRing({
  value,
  max,
  size = 56,
  strokeWidth = 5,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const tone = ratio >= 0.9 ? "stroke-danger" : ratio >= 0.75 ? "stroke-warning" : "stroke-primary";
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {/* Rotate so the arc starts at 12 o'clock. */}
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-line" />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference * ratio} ${circumference}`}
            className={cn("transition-[stroke-dasharray] duration-300 ease-(--ease-decel)", tone)}
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}
