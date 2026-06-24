export type ZIndexToken = {
  value: number;
  cssVar: string;
  description: string;
};

export const zIndexTokens: Record<string, ZIndexToken> = {
  "z.base": {
    cssVar: "--z-base",
    value: 0,
    description: "Default stacking context. Static content, canvas background, graph base layer.",
  },
  "z.raised": {
    cssVar: "--z-raised",
    value: 1,
    description: "Slightly elevated — selected graph node, active list row, hovered card.",
  },
  "z.dropdown": {
    cssVar: "--z-dropdown",
    value: 10,
    description: "Dropdown menus, select popups, inline autocomplete lists.",
  },
  "z.sticky": {
    cssVar: "--z-sticky",
    value: 20,
    description: "Sticky headers, pinned sidebar elements, floating action buttons.",
  },
  "z.overlay": {
    cssVar: "--z-overlay",
    value: 30,
    description: "Drawer overlays and non-blocking sidesheets.",
  },
  "z.modal": {
    cssVar: "--z-modal",
    value: 40,
    description: "Modal dialogs, confirm prompts, and blocking overlays.",
  },
  "z.toast": {
    cssVar: "--z-toast",
    value: 50,
    description: "Toast notifications and snackbars — above modals so they're always visible.",
  },
  "z.tooltip": {
    cssVar: "--z-tooltip",
    value: 60,
    description: "Tooltips — highest managed layer. Nothing should obscure helper text.",
  },
};
