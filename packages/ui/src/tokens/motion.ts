export type DurationToken = {
  value: string;
  ms: number;
  cssVar: string;
  description: string;
};

export type EasingToken = {
  value: string;
  cssVar: string;
  description: string;
  usage: string;
};

export const durationTokens: Record<string, DurationToken> = {
  "duration.instant": {
    cssVar: "--duration-instant",
    value: "50ms",
    ms: 50,
    description: "Imperceptible — state toggles and immediate visual feedback like checkbox checks.",
  },
  "duration.fast": {
    cssVar: "--duration-fast",
    value: "100ms",
    ms: 100,
    description: "Quick feedback — button press, hover state, icon swap. Never feels laggy.",
  },
  "duration.base": {
    cssVar: "--duration-base",
    value: "200ms",
    ms: 200,
    description: "Default for most transitions: color, opacity, border, shadow. Feels intentional.",
  },
  "duration.slow": {
    cssVar: "--duration-slow",
    value: "300ms",
    ms: 300,
    description: "Element enter/exit: dropdowns, sidepanels sliding in, dialogs mounting.",
  },
  "duration.slower": {
    cssVar: "--duration-slower",
    value: "500ms",
    ms: 500,
    description: "Large spatial transitions: page-level navigation, full-screen graph zoom.",
  },
};

export const easingTokens: Record<string, EasingToken> = {
  "easing.standard": {
    cssVar: "--easing-standard",
    value: "cubic-bezier(0.2, 0, 0, 1)",
    description: "Default for elements that stay on screen. Decelerates to rest.",
    usage: "transition: opacity var(--duration-base) var(--easing-standard)",
  },
  "easing.decelerate": {
    cssVar: "--easing-decelerate",
    value: "cubic-bezier(0, 0, 0, 1)",
    description: "Elements entering the viewport — panels sliding in, dialogs mounting. Arrives softly.",
    usage: "transition: transform var(--duration-slow) var(--easing-decelerate)",
  },
  "easing.accelerate": {
    cssVar: "--easing-accelerate",
    value: "cubic-bezier(0.3, 0, 1, 1)",
    description: "Elements leaving the viewport — panels dismissing, overlays closing. Exits decisively.",
    usage: "transition: transform var(--duration-slow) var(--easing-accelerate)",
  },
  "easing.spring": {
    cssVar: "--easing-spring",
    value: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    description: "Playful overshoot for emphasis: popover appearance, drag-and-drop snap.",
    usage: "transition: transform var(--duration-base) var(--easing-spring)",
  },
};
