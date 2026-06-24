export type FontToken = {
  css: string;
  family: "sans" | "mono";
  size: string;
  weight: number;
  lineHeight: string;
  description: string;
  usage: string;
};

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif';
const MONO = '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace';

export const fontTokens: Record<string, FontToken> = {
  // ── Heading ──────────────────────────────────────────────────────────────
  "font.heading.xxlarge": {
    css: `600 2rem/1.1 ${MONO}`,
    family: "mono", size: "32px", weight: 600, lineHeight: "1.1",
    description: "Workspace titles and top-level navigation. Mono face signals a structured, authored identity.",
    usage: "font",
  },
  "font.heading.xlarge": {
    css: `700 1.625rem/1.15 ${SANS}`,
    family: "sans", size: "26px", weight: 700, lineHeight: "1.15",
    description: "Primary page titles such as project overview and graph views.",
    usage: "font",
  },
  "font.heading.large": {
    css: `600 1.25rem/1.25 ${SANS}`,
    family: "sans", size: "20px", weight: 600, lineHeight: "1.25",
    description: "Major section headings and panel titles.",
    usage: "font",
  },
  "font.heading.medium": {
    css: `600 1rem/1.3 ${SANS}`,
    family: "sans", size: "16px", weight: 600, lineHeight: "1.3",
    description: "Headers inside cards, dialogs, and modals.",
    usage: "font",
  },
  "font.heading.small": {
    css: `600 0.8125rem/1.4 ${SANS}`,
    family: "sans", size: "13px", weight: 600, lineHeight: "1.4",
    description: "Sidebar section labels and compact component headers.",
    usage: "font",
  },
  "font.heading.xsmall": {
    css: `600 0.6875rem/1.4 ${MONO}`,
    family: "mono", size: "11px", weight: 600, lineHeight: "1.4",
    description: "Tight mono labels for collapsed panels and dense tree nodes.",
    usage: "font",
  },

  // ── Body ─────────────────────────────────────────────────────────────────
  "font.body.large": {
    css: `400 0.9375rem/1.6 ${SANS}`,
    family: "sans", size: "15px", weight: 400, lineHeight: "1.6",
    description: "Primary reading content such as message text and artifact descriptions.",
    usage: "font",
  },
  "font.body.medium": {
    css: `400 0.875rem/1.55 ${SANS}`,
    family: "sans", size: "14px", weight: 400, lineHeight: "1.55",
    description: "Default body text across the application.",
    usage: "font",
  },
  "font.body.small": {
    css: `400 0.8125rem/1.5 ${SANS}`,
    family: "sans", size: "13px", weight: 400, lineHeight: "1.5",
    description: "Secondary content, metadata, and supporting descriptions.",
    usage: "font",
  },
  "font.body.xsmall": {
    css: `400 0.75rem/1.5 ${SANS}`,
    family: "sans", size: "12px", weight: 400, lineHeight: "1.5",
    description: "Timestamps, version numbers, and supplementary information.",
    usage: "font",
  },

  // ── Label ─────────────────────────────────────────────────────────────────
  "font.label.large": {
    css: `600 0.75rem/1 ${MONO}`,
    family: "mono", size: "12px", weight: 600, lineHeight: "1",
    description: "Section category labels and panel eyebrows. Always uppercase with letter-spacing.",
    usage: "font",
  },
  "font.label.medium": {
    css: `600 0.6875rem/1 ${MONO}`,
    family: "mono", size: "11px", weight: 600, lineHeight: "1",
    description: "Default label for sidebar section headers and form labels.",
    usage: "font",
  },
  "font.label.small": {
    css: `600 0.625rem/1 ${MONO}`,
    family: "mono", size: "10px", weight: 600, lineHeight: "1",
    description: "Compact labels for dense UI contexts and inline metadata tags.",
    usage: "font",
  },

  // ── Code ─────────────────────────────────────────────────────────────────
  "font.code.medium": {
    css: `400 0.8125rem/1.6 ${MONO}`,
    family: "mono", size: "13px", weight: 400, lineHeight: "1.6",
    description: "Code blocks and shell output in artifact and message views.",
    usage: "font",
  },
  "font.code.small": {
    css: `400 0.75rem/1.5 ${MONO}`,
    family: "mono", size: "12px", weight: 400, lineHeight: "1.5",
    description: "Inline code spans, branch names, and node identifiers.",
    usage: "font",
  },
};
