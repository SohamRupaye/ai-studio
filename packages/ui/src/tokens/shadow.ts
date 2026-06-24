export type ShadowToken = {
  light: string;
  dark: string;
  cssVar: string;
  description: string;
  usage: string;
};

export const shadowTokens: Record<string, ShadowToken> = {
  "shadow.xs": {
    cssVar: "--shadow-xs",
    light: "0 1px 2px rgba(0,0,0,.06)",
    dark:  "0 1px 2px rgba(0,0,0,.40)",
    description: "Minimal lift for inline elements: selected row, active chip, hovered icon button.",
    usage: "box-shadow: var(--shadow-xs)",
  },
  "shadow.sm": {
    cssVar: "--shadow-sm",
    light: "0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)",
    dark:  "0 1px 4px rgba(0,0,0,.40), 0 0 1px rgba(0,0,0,.30)",
    description: "Subtle elevation for cards, sidebar panels, and tree containers.",
    usage: "box-shadow: var(--shadow-sm)",
  },
  "shadow.md": {
    cssVar: "--shadow-md",
    light: "0 4px 12px rgba(0,0,0,.10), 0 2px 4px rgba(0,0,0,.06)",
    dark:  "0 4px 12px rgba(0,0,0,.50), 0 0 2px rgba(0,0,0,.30)",
    description: "Standard elevation for dropdowns, menus, and content panels.",
    usage: "box-shadow: var(--shadow-md)",
  },
  "shadow.lg": {
    cssVar: "--shadow-lg",
    light: "0 8px 24px rgba(0,0,0,.12), 0 4px 8px rgba(0,0,0,.08)",
    dark:  "0 8px 24px rgba(0,0,0,.60), 0 0 2px rgba(0,0,0,.30)",
    description: "High elevation for dialogs and full-height drawer overlays.",
    usage: "box-shadow: var(--shadow-lg)",
  },
  "shadow.xl": {
    cssVar: "--shadow-xl",
    light: "0 16px 40px rgba(0,0,0,.14), 0 8px 16px rgba(0,0,0,.10)",
    dark:  "0 16px 48px rgba(0,0,0,.70), 0 0 4px rgba(0,0,0,.20)",
    description: "Maximum elevation for the command palette and full-screen overlays.",
    usage: "box-shadow: var(--shadow-xl)",
  },
  "shadow.float": {
    cssVar: "--shadow-float",
    light: "0 2px 8px rgba(0,0,0,.10), 0 1px 3px rgba(0,0,0,.08)",
    dark:  "0 2px 8px rgba(0,0,0,.50), 0 1px 3px rgba(0,0,0,.30)",
    description: "Tooltips, popovers, and context menus — tight shadow that suggests proximity.",
    usage: "box-shadow: var(--shadow-float)",
  },
};
