export const BASE_UNIT_PX = 4;

export type SpaceToken = {
  multiplier: number;
  rem: string;
  px: number;
  cssVar: string;
  description: string;
};

export const spaceTokens: Record<string, SpaceToken> = {
  "space.0":    { multiplier: 0,    rem: "0",          px: 0,  cssVar: "--space-0",    description: "No spacing. Used to explicitly reset margin or padding." },
  "space.025":  { multiplier: 0.25, rem: "0.0625rem",  px: 1,  cssVar: "--space-025",  description: "Hair-thin separation. Icon sub-pixel alignment." },
  "space.050":  { multiplier: 0.5,  rem: "0.125rem",   px: 2,  cssVar: "--space-050",  description: "Tight inline gap. Dot indicators, badge internal padding." },
  "space.075":  { multiplier: 0.75, rem: "0.1875rem",  px: 3,  cssVar: "--space-075",  description: "Sub-unit gap for dense tree items and compact status rows." },
  "space.100":  { multiplier: 1,    rem: "0.25rem",    px: 4,  cssVar: "--space-100",  description: "Base unit. Minimum meaningful spacing between sibling elements." },
  "space.150":  { multiplier: 1.5,  rem: "0.375rem",   px: 6,  cssVar: "--space-150",  description: "Icon-to-label gap in tree items, badge padding." },
  "space.200":  { multiplier: 2,    rem: "0.5rem",     px: 8,  cssVar: "--space-200",  description: "Default gap between inline elements and button icon gap." },
  "space.250":  { multiplier: 2.5,  rem: "0.625rem",   px: 10, cssVar: "--space-250",  description: "Tree item horizontal padding." },
  "space.300":  { multiplier: 3,    rem: "0.75rem",    px: 12,  cssVar: "--space-300",  description: "Sidebar horizontal padding, card inner gap." },
  "space.350":  { multiplier: 3.5,  rem: "0.875rem",   px: 14,  cssVar: "--space-350",  description: "Medium-compact padding for chip rows and tag lists." },
  "space.400":  { multiplier: 4,    rem: "1rem",       px: 16,  cssVar: "--space-400",  description: "Panel horizontal padding. Primary spacing unit for most components." },
  "space.500":  { multiplier: 5,    rem: "1.25rem",    px: 20,  cssVar: "--space-500",  description: "Gap between sections inside a panel or card." },
  "space.600":  { multiplier: 6,    rem: "1.5rem",     px: 24,  cssVar: "--space-600",  description: "Card internal padding, section top/bottom padding." },
  "space.700":  { multiplier: 7,    rem: "1.75rem",    px: 28,  cssVar: "--space-700",  description: "Slightly wider than a card pad — used in expanded list items." },
  "space.800":  { multiplier: 8,    rem: "2rem",       px: 32,  cssVar: "--space-800",  description: "Space between major layout regions." },
  "space.900":  { multiplier: 9,    rem: "2.25rem",    px: 36,  cssVar: "--space-900",  description: "Dialog internal padding, form section spacing." },
  "space.1000": { multiplier: 10,   rem: "2.5rem",     px: 40,  cssVar: "--space-1000", description: "Vertical breathing room between document-level sections." },
  "space.1200": { multiplier: 12,   rem: "3rem",       px: 48,  cssVar: "--space-1200", description: "Large layout gaps; sidebar header clearance." },
  "space.1400": { multiplier: 14,   rem: "3.5rem",     px: 56,  cssVar: "--space-1400", description: "Tall section headers, toolbar height in expanded state." },
  "space.1600": { multiplier: 16,   rem: "4rem",       px: 64,  cssVar: "--space-1600", description: "Full-page section separation and hero-area padding." },
  "space.2000": { multiplier: 20,   rem: "5rem",       px: 80,  cssVar: "--space-2000", description: "Empty-state illustration clearance, splash screen margin." },
  "space.2400": { multiplier: 24,   rem: "6rem",       px: 96,  cssVar: "--space-2400", description: "Maximum content padding for very wide panels." },
  "space.3200": { multiplier: 32,   rem: "8rem",       px: 128, cssVar: "--space-3200", description: "Full-bleed layout offsets, graph canvas inset." },
};
