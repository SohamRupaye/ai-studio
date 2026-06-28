import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight, dependency-free Markdown renderer.
// Supports: headings, bold, italics, strikethrough, inline code, fenced code
// blocks, unordered/ordered lists (with nesting), blockquotes, horizontal
// rules, links, and paragraphs with soft line breaks.
// ─────────────────────────────────────────────────────────────────────────────

export function Markdown({ content, className }: { content: string; className?: string }) {
  keySeq = 0;
  const blocks = parseBlocks(content.replace(/\r\n/g, "\n"));
  return <div className={cn("space-y-2 text-sm leading-relaxed", className)}>{blocks}</div>;
}

// ── Inline parsing ───────────────────────────────────────────────────────────

let keySeq = 0;
function k(): number {
  return keySeq++;
}

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;

  // Ordered by matching priority. Code is first so nothing inside it is parsed.
  const rules: { re: RegExp; make: (m: RegExpExecArray) => ReactNode }[] = [
    {
      re: /`([^`]+)`/,
      make: (m) => (
        <code
          key={k()}
          className="rounded-[5px] bg-muted px-[5px] py-px font-mono text-[0.85em] text-foreground/90"
        >
          {m[1]}
        </code>
      ),
    },
    { re: /\*\*([^*]+?)\*\*/, make: (m) => <strong key={k()}>{parseInline(m[1])}</strong> },
    { re: /__([^_]+?)__/, make: (m) => <strong key={k()}>{parseInline(m[1])}</strong> },
    { re: /~~([^~]+?)~~/, make: (m) => <span key={k()} className="line-through">{parseInline(m[1])}</span> },
    { re: /(?<![\w*])\*([^*\n]+?)\*(?![\w*])/, make: (m) => <em key={k()}>{parseInline(m[1])}</em> },
    { re: /(?<![\w_])_([^_\n]+?)_(?![\w_])/, make: (m) => <em key={k()}>{parseInline(m[1])}</em> },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      make: (m) => (
        <a
          key={k()}
          href={m[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {parseInline(m[1])}
        </a>
      ),
    },
  ];

  let guard = 0;
  while (rest && guard++ < 10_000) {
    let best: { index: number; length: number; node: ReactNode } | null = null;
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: rule.make(m) };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.index > 0) nodes.push(rest.slice(0, best.index));
    nodes.push(best.node);
    rest = rest.slice(best.index + best.length);
  }
  return nodes;
}

/** Parse inline text but turn single newlines into <br/> soft breaks. */
function parseInlineWithBreaks(text: string): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    out.push(<Fragment key={k()}>{parseInline(line)}</Fragment>);
    if (i < lines.length - 1) out.push(<br key={k()} />);
  });
  return out;
}

// ── Block parsing ────────────────────────────────────────────────────────────

const HEADING_CLASS: Record<number, string> = {
  1: "font-h3 mt-1",
  2: "font-h4 mt-1",
  3: "font-h5",
  4: "font-h5",
  5: "font-h6",
  6: "font-h6",
};

interface ListItem {
  indent: number;
  ordered: boolean;
  content: string;
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <div key={k()} className="overflow-hidden rounded-lg border border-border/80">
          {lang && (
            <div className="border-b border-border/70 bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              {lang}
            </div>
          )}
          <pre className="overflow-x-auto bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <div key={k()} className={cn(HEADING_CLASS[level], "text-foreground")}>
          {parseInline(heading[2])}
        </div>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={k()} className="my-3 border-border" />);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={k()}
          className="border-l-2 border-border pl-3 text-muted-foreground"
        >
          {parseInlineWithBreaks(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    // Lists (ordered or unordered) — collect contiguous list lines
    if (isListLine(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(parseListLine(lines[i]));
        i++;
      }
      blocks.push(renderList(items));
      continue;
    }

    // Paragraph — gather until blank line or a block-starting line
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isListLine(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className="leading-relaxed">
        {parseInlineWithBreaks(para.join("\n"))}
      </p>,
    );
  }

  return blocks;
}

function isListLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s+/.test(line);
}

function parseListLine(line: string): ListItem {
  const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)!;
  return {
    indent: m[1].length,
    ordered: /\d+\./.test(m[2]),
    content: m[3],
  };
}

/** Render a flat list of items, nesting by indentation. */
function renderList(items: ListItem[], start = 0, baseIndent = items[0]?.indent ?? 0): ReactNode {
  const ordered = items[start]?.ordered ?? false;
  const children: ReactNode[] = [];
  let i = start;

  while (i < items.length && items[i].indent >= baseIndent) {
    if (items[i].indent > baseIndent) {
      // Nested list — attach to the previous item
      const nestedStart = i;
      const nestedIndent = items[i].indent;
      let j = i;
      while (j < items.length && items[j].indent >= nestedIndent) j++;
      const nested = renderList(items.slice(nestedStart, j), 0, nestedIndent);
      const last = children.pop();
      children.push(
        <li key={k()} className="ml-0">
          {last && (last as any).props ? (last as any).props.children : last}
          {nested}
        </li>,
      );
      i = j;
      continue;
    }
    children.push(<li key={k()}>{parseInline(items[i].content)}</li>);
    i++;
  }

  return ordered ? (
    <ol key={k()} className="list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ) : (
    <ul key={k()} className="list-disc space-y-1 pl-5">
      {children}
    </ul>
  );
}
