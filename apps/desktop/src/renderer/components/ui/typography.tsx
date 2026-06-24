import { cva, type VariantProps } from "class-variance-authority";
import { type ElementType, forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* ── Heading ─────────────────────────────────────────────────────────────────
   Maps to H1–H6 font tokens via the .font-h* utility classes in globals.css.
   Picks the semantically correct HTML tag by default; override with `as`.

   <Heading size="h1">AI Studio</Heading>
   <Heading size="h2" as="div">Section not in document outline</Heading>
─────────────────────────────────────────────────────────────────────────── */

const headingVariants = cva("text-foreground", {
  variants: {
    size: {
      h1: "font-h1",
      h2: "font-h2",
      h3: "font-h3",
      h4: "font-h4",
      h5: "font-h5",
      h6: "font-h6",
    },
  },
  defaultVariants: { size: "h2" },
});

const HEADING_TAG = {
  h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6",
} as const;

type HeadingSize = keyof typeof HEADING_TAG;

type HeadingProps = HTMLAttributes<HTMLHeadingElement> &
  VariantProps<typeof headingVariants> & {
    as?: ElementType;
  };

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ size = "h2", as, className, ...props }, ref) => {
    const Tag = (as ?? HEADING_TAG[size as HeadingSize ?? "h2"]) as ElementType;
    return (
      <Tag
        ref={ref}
        className={cn(headingVariants({ size }), className)}
        {...props}
      />
    );
  }
);
Heading.displayName = "Heading";

/* ── Text ────────────────────────────────────────────────────────────────────
   Body copy in four sizes, three color variants.

   <Text>Default body paragraph</Text>
   <Text size="sm" variant="muted">Helper text below an input</Text>
   <Text size="xs" variant="subtle">Timestamp</Text>
─────────────────────────────────────────────────────────────────────────── */

const textVariants = cva("", {
  variants: {
    size: {
      lg: "font-body-lg",
      md: "font-body-md",
      sm: "font-body-sm",
      xs: "font-body-xs",
    },
    variant: {
      default: "text-foreground",
      muted:   "text-muted-foreground",
      subtle:  "text-muted-foreground/60",
    },
  },
  defaultVariants: { size: "md", variant: "default" },
});

type TextProps = HTMLAttributes<HTMLParagraphElement> &
  VariantProps<typeof textVariants> & {
    as?: ElementType;
  };

const Text = forwardRef<HTMLParagraphElement, TextProps>(
  ({ size, variant, as: Tag = "p", className, ...props }, ref) => (
    <Tag
      ref={ref}
      className={cn(textVariants({ size, variant }), className)}
      {...props}
    />
  )
);
Text.displayName = "Text";

/* ── Code ────────────────────────────────────────────────────────────────────
   Inline code spans and code block wrappers.

   <Code>branch/oauth-flow</Code>
   <Code block size="lg">const x = 1;</Code>
─────────────────────────────────────────────────────────────────────────── */

const codeVariants = cva("font-mono text-primary bg-muted rounded", {
  variants: {
    size: {
      lg: "font-code-lg",
      md: "font-code-md",
      sm: "font-code-sm",
    },
    block: {
      true:  "block w-full rounded-md px-3 py-2",
      false: "px-1.5 py-0.5",
    },
  },
  defaultVariants: { size: "sm", block: false },
});

type CodeProps = HTMLAttributes<HTMLElement> & VariantProps<typeof codeVariants>;

const Code = forwardRef<HTMLElement, CodeProps>(
  ({ size, block, className, ...props }, ref) => (
    <code
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={cn(codeVariants({ size, block }), className)}
      {...props}
    />
  )
);
Code.displayName = "Code";

/* ── EyebrowLabel ────────────────────────────────────────────────────────────
   Structural mono labels above sections, panel headers, form groups.
   Always uppercase + tracked — baked into the .font-label-* utility.

   <EyebrowLabel>Active Branch</EyebrowLabel>
   <EyebrowLabel size="sm">v0.2.0</EyebrowLabel>
─────────────────────────────────────────────────────────────────────────── */

type EyebrowLabelProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "lg" | "md" | "sm";
  as?: ElementType;
};

const EyebrowLabel = forwardRef<HTMLSpanElement, EyebrowLabelProps>(
  ({ size = "md", as: Tag = "span", className, ...props }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        size === "lg" ? "font-label-lg" : size === "sm" ? "font-label-sm" : "font-label-md",
        "text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);
EyebrowLabel.displayName = "EyebrowLabel";

export { Heading, Text, Code, EyebrowLabel };
