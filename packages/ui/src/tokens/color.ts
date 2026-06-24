/* Primitive color ramps and data visualization palette */

export type ColorStep = {
  hsl: string;
  cssVar: string;
  approximate: string;
};

export type PrimitiveRamp = Record<string, ColorStep>;

function rampStep(hsl: string, cssVar: string, approximate: string): ColorStep {
  return { hsl, cssVar, approximate };
}

export const indigoRamp: PrimitiveRamp = {
  "indigo.50":  rampStep("229 80% 97%", "--indigo-50",  "#EFF1FD"),
  "indigo.100": rampStep("229 70% 94%", "--indigo-100", "#E4E7FA"),
  "indigo.200": rampStep("229 68% 87%", "--indigo-200", "#CBD2F5"),
  "indigo.300": rampStep("229 66% 77%", "--indigo-300", "#A9B5EE"),
  "indigo.400": rampStep("229 65% 68%", "--indigo-400", "#7A8EE8"),
  "indigo.500": rampStep("229 65% 62%", "--indigo-500", "#5B6FE0"),
  "indigo.600": rampStep("232 57% 55%", "--indigo-600", "#4855CC"),
  "indigo.700": rampStep("232 60% 44%", "--indigo-700", "#3342A8"),
  "indigo.800": rampStep("232 62% 32%", "--indigo-800", "#24307B"),
  "indigo.900": rampStep("232 60% 22%", "--indigo-900", "#182157"),
  "indigo.950": rampStep("232 58% 13%", "--indigo-950", "#0E1333"),
};

export const amberRamp: PrimitiveRamp = {
  "amber.50":  rampStep("33 100% 97%", "--amber-50",  "#FFF8EE"),
  "amber.100": rampStep("33  95% 93%", "--amber-100", "#FDEFD8"),
  "amber.200": rampStep("33  88% 83%", "--amber-200", "#F9D8A3"),
  "amber.300": rampStep("33  78% 72%", "--amber-300", "#F2BC6C"),
  "amber.400": rampStep("33  65% 62%", "--amber-400", "#D9984E"),
  "amber.500": rampStep("33  55% 54%", "--amber-500", "#C9934A"),
  "amber.600": rampStep("33  55% 44%", "--amber-600", "#B07A35"),
  "amber.700": rampStep("33  55% 35%", "--amber-700", "#8A5F26"),
  "amber.800": rampStep("33  50% 26%", "--amber-800", "#624318"),
  "amber.900": rampStep("33  45% 18%", "--amber-900", "#422D0D"),
  "amber.950": rampStep("33  40% 11%", "--amber-950", "#281A07"),
};

export const slateRamp: PrimitiveRamp = {
  "slate.50":  rampStep("229 20% 96%", "--slate-50",  "#F2F3F7"),
  "slate.100": rampStep("228 20% 93%", "--slate-100", "#EAECF4"),
  "slate.200": rampStep("228 18% 88%", "--slate-200", "#DADDF0"),
  "slate.300": rampStep("228 16% 80%", "--slate-300", "#C4C8E0"),
  "slate.400": rampStep("228 14% 66%", "--slate-400", "#9BA0BF"),
  "slate.500": rampStep("228 12% 52%", "--slate-500", "#737A99"),
  "slate.600": rampStep("228 16% 38%", "--slate-600", "#4D5472"),
  "slate.700": rampStep("227 22% 25%", "--slate-700", "#303A5A"),
  "slate.800": rampStep("226 25% 16%", "--slate-800", "#1D2236"),
  "slate.900": rampStep("226 26% 10%", "--slate-900", "#131721"),
  "slate.950": rampStep("226 28%  7%", "--slate-950", "#0C0F18"),
};

export const greenRamp: PrimitiveRamp = {
  "green.50":  rampStep("145 55% 97%", "--green-50",  "#F0FBF5"),
  "green.100": rampStep("145 52% 92%", "--green-100", "#D8F4E6"),
  "green.200": rampStep("145 50% 82%", "--green-200", "#ACE8C9"),
  "green.300": rampStep("145 48% 68%", "--green-300", "#75D4A3"),
  "green.400": rampStep("145 45% 56%", "--green-400", "#4ABF85"),
  "green.500": rampStep("145 42% 47%", "--green-500", "#44A870"),
  "green.600": rampStep("145 48% 38%", "--green-600", "#2D9B5C"),
  "green.700": rampStep("145 52% 29%", "--green-700", "#1D7242"),
  "green.800": rampStep("145 50% 21%", "--green-800", "#15522F"),
  "green.900": rampStep("145 48% 14%", "--green-900", "#0D371F"),
  "green.950": rampStep("145 45%  8%", "--green-950", "#071F11"),
};

export const redRamp: PrimitiveRamp = {
  "red.50":  rampStep("4 100% 97%", "--red-50",  "#FFF0EF"),
  "red.100": rampStep("4  90% 93%", "--red-100", "#FDDDD9"),
  "red.200": rampStep("4  80% 85%", "--red-200", "#F9B8B3"),
  "red.300": rampStep("4  75% 74%", "--red-300", "#F38D85"),
  "red.400": rampStep("4  72% 66%", "--red-400", "#EC6B61"),
  "red.500": rampStep("4  70% 58%", "--red-500", "#E55B4D"),
  "red.600": rampStep("4  72% 50%", "--red-600", "#DC2424"),
  "red.700": rampStep("4  70% 40%", "--red-700", "#BD1F1F"),
  "red.800": rampStep("4  65% 30%", "--red-800", "#8F1717"),
  "red.900": rampStep("4  60% 20%", "--red-900", "#5F0F0F"),
  "red.950": rampStep("4  55% 12%", "--red-950", "#390808"),
};

export const yellowRamp: PrimitiveRamp = {
  "yellow.50":  rampStep("35 100% 97%", "--yellow-50",  "#FFFAEE"),
  "yellow.100": rampStep("35  95% 92%", "--yellow-100", "#FEF0CC"),
  "yellow.200": rampStep("35  90% 82%", "--yellow-200", "#FDDA90"),
  "yellow.300": rampStep("35  84% 70%", "--yellow-300", "#F9BC52"),
  "yellow.400": rampStep("35  80% 62%", "--yellow-400", "#F4A32B"),
  "yellow.500": rampStep("35  75% 58%", "--yellow-500", "#E5A030"),
  "yellow.600": rampStep("35  80% 48%", "--yellow-600", "#C47A10"),
  "yellow.700": rampStep("35  78% 38%", "--yellow-700", "#9B5C0A"),
  "yellow.800": rampStep("35  72% 28%", "--yellow-800", "#6D4008"),
  "yellow.900": rampStep("35  65% 19%", "--yellow-900", "#452A06"),
  "yellow.950": rampStep("35  60% 12%", "--yellow-950", "#2A1904"),
};

export const primitiveRamps = {
  indigo: indigoRamp,
  amber:  amberRamp,
  slate:  slateRamp,
  green:  greenRamp,
  red:    redRamp,
  yellow: yellowRamp,
};

/* ── Data Visualization ──────────────────────────────────────────────────── */

export type VizToken = {
  cssVar: string;
  description: string;
  semanticAlias?: string;
  role: "categorical" | "sequential";
};

export const vizCategoricalTokens: Record<string, VizToken> = {
  "viz.cat.1": {
    cssVar: "--viz-cat-1",
    description: "Indigo — conversation nodes and AI turn markers.",
    semanticAlias: "--viz-node-conversation",
    role: "categorical",
  },
  "viz.cat.2": {
    cssVar: "--viz-cat-2",
    description: "Amber — decision nodes and choice points.",
    semanticAlias: "--viz-node-decision",
    role: "categorical",
  },
  "viz.cat.3": {
    cssVar: "--viz-cat-3",
    description: "Green — code artifacts and implementation nodes.",
    semanticAlias: "--viz-node-code",
    role: "categorical",
  },
  "viz.cat.4": {
    cssVar: "--viz-cat-4",
    description: "Violet — references, documentation links.",
    semanticAlias: "--viz-node-reference",
    role: "categorical",
  },
  "viz.cat.5": {
    cssVar: "--viz-cat-5",
    description: "Cyan — tasks and actionable items.",
    semanticAlias: "--viz-node-task",
    role: "categorical",
  },
  "viz.cat.6": {
    cssVar: "--viz-cat-6",
    description: "Red — issues, errors, and failed operations.",
    semanticAlias: "--viz-node-issue",
    role: "categorical",
  },
  "viz.cat.7": {
    cssVar: "--viz-cat-7",
    description: "Lime — notes and lightweight observations.",
    semanticAlias: "--viz-node-note",
    role: "categorical",
  },
  "viz.cat.8": {
    cssVar: "--viz-cat-8",
    description: "Slate — unclassified or unknown node types.",
    semanticAlias: "--viz-node-unknown",
    role: "categorical",
  },
};

export const vizSequentialTokens: Record<string, VizToken> = {
  "viz.seq.1": {
    cssVar: "--viz-seq-1",
    description: "Lowest relevance / weakest edge weight.",
    role: "sequential",
  },
  "viz.seq.2": {
    cssVar: "--viz-seq-2",
    description: "Low-moderate relevance.",
    role: "sequential",
  },
  "viz.seq.3": {
    cssVar: "--viz-seq-3",
    description: "Moderate relevance.",
    role: "sequential",
  },
  "viz.seq.4": {
    cssVar: "--viz-seq-4",
    description: "High relevance.",
    role: "sequential",
  },
  "viz.seq.5": {
    cssVar: "--viz-seq-5",
    description: "Highest relevance / strongest edge weight.",
    role: "sequential",
  },
};
