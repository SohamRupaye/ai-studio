export type BorderWidthToken = {
  value: string;
  cssVar: string;
  description: string;
};

export type BorderRadiusToken = {
  value: string;
  cssVar: string;
  description: string;
};

export type BorderColorToken = {
  cssVar: string;
  description: string;
  role: "neutral" | "brand" | "semantic";
};

export const borderWidthTokens: Record<string, BorderWidthToken> = {
  "border.width": {
    value: "1px",
    cssVar: "--border-width",
    description: "Default width for all component borders, dividers, and separators.",
  },
  "border.width.selected": {
    value: "2px",
    cssVar: "--border-width-selected",
    description: "Indicates the currently selected element — active tab, chosen branch, or focused list item.",
  },
  "border.width.focused": {
    value: "2px",
    cssVar: "--border-width-focused",
    description: "Focus ring width on interactive elements. Meets WCAG 2.2 focus-visible requirements.",
  },
  "border.width.none": {
    value: "0px",
    cssVar: "--border-width-none",
    description: "Explicitly removes a border. Use when toggling border visibility.",
  },
};

export const borderRadiusTokens: Record<string, BorderRadiusToken> = {
  "border.radius.none": {
    value: "0px",
    cssVar: "--border-radius-none",
    description: "No rounding. For flush, edge-to-edge elements like full-width separators.",
  },
  "border.radius.small": {
    value: "3px",
    cssVar: "--border-radius-small",
    description: "Badges, inline code chips, and tag elements.",
  },
  "border.radius.medium": {
    value: "6px",
    cssVar: "--border-radius-medium",
    description: "Buttons, text inputs, tree row hover states, and most interactive elements.",
  },
  "border.radius.large": {
    value: "8px",
    cssVar: "--border-radius-large",
    description: "Cards, collapsed panels, and notification banners.",
  },
  "border.radius.xlarge": {
    value: "12px",
    cssVar: "--border-radius-xlarge",
    description: "Dialogs, modals, popovers, and floating overlays.",
  },
  "border.radius.xxlarge": {
    value: "16px",
    cssVar: "--border-radius-xxlarge",
    description: "Large floating surfaces such as sidesheets and full-height drawers.",
  },
  "border.radius.circle": {
    value: "9999px",
    cssVar: "--border-radius-circle",
    description: "Avatars, status dots, and pill-shaped badges.",
  },
};

export const borderColorTokens: Record<string, BorderColorToken> = {
  "border.color": {
    cssVar: "--border",
    description: "Default border color for all structural containers and component outlines.",
    role: "neutral",
  },
  "border.color.selected": {
    cssVar: "--highlight",
    description: "Amber accent border for the currently active branch, selected node, or chosen item.",
    role: "brand",
  },
  "border.color.focused": {
    cssVar: "--ring",
    description: "Indigo focus ring color applied on keyboard focus via outline or box-shadow.",
    role: "brand",
  },
  "border.color.danger": {
    cssVar: "--destructive",
    description: "Danger state borders on inputs with validation errors or destructive action cards.",
    role: "semantic",
  },
  "border.color.success": {
    cssVar: "--success",
    description: "Success state borders indicating completed operations or verified nodes.",
    role: "semantic",
  },
  "border.color.warning": {
    cssVar: "--warning",
    description: "Warning state borders for cautions, approaching limits, or pending states.",
    role: "semantic",
  },
};
