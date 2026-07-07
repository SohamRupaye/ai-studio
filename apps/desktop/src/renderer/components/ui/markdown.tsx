import * as React from "react";
import { CopyIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { Button } from "./button";

// Lightweight markdown renderer for assistant output — no dependency, tuned
// for what models actually produce (paragraphs, lists, fenced code, inline
// code/bold/italic/links) rather than full CommonMark. Built to render
// mid-stream text safely: an unterminated ``` fence at the end of the input
// just renders as an in-progress code block instead of breaking.

interface Block {
  kind: "paragraph" | "heading" | "code" | "ul" | "ol" | "quote";
  text?: string;
  level?: number;
  lang?: string;
  items?: string[];
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = line.match(/^```\s*(\S*)/);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.match(/^```\s*$/)) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // consume closing fence (or end of input, if unterminated)
      blocks.push({ kind: "code", text: codeLines.join("\n"), lang });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2] });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }

    if (/^(-|\*)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(-|\*)\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^(-|\*)\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: gather until a blank line or the start of another block kind.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !/^(-|\*)\s+/.test(lines[i]!) &&
      !/^\d+[.)]\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join("\n") });
  }

  return blocks;
}

// Inline tokens: code spans first (so ** inside `` isn't touched), then
// bold, italic, links. No nesting — matches what LLM prose actually needs.
const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/;

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  // Fresh regex per call: renderInline recurses (bold/italic content), and a
  // shared global regex carries its scan position on the object itself — the
  // recursive call would clobber it and send the outer loop back to 0,
  // re-matching the same token forever (real OOM crash, not hypothetical).
  const re = new RegExp(INLINE_PATTERN.source, "g");
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(withBreaks(text.slice(last, match.index), key++));
    const [, code, bold, italic, linkText, linkHref] = match;
    if (code !== undefined) {
      nodes.push(
        <code key={key++} className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em] text-fg">
          {code}
        </code>,
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={key++} className="font-semibold text-fg">{renderInline(bold)}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{renderInline(italic)}</em>);
    } else if (linkText !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={linkHref}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          {linkText}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(withBreaks(text.slice(last), key++));
  return nodes;
}

function withBreaks(text: string, key: number): React.ReactNode {
  const parts = text.split("\n");
  return (
    <React.Fragment key={key}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {part}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };
  return (
    <div className="group/code relative my-1 overflow-hidden rounded-md border border-line bg-surface-2">
      {lang && (
        <div className="border-b border-line px-3 py-1 font-mono text-[11px] text-fg-subtle">{lang}</div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy code"
        onClick={copy}
        className="absolute right-1.5 top-1.5 opacity-0 group-hover/code:opacity-100"
      >
        <CopyIcon />
      </Button>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-[12.5px] leading-relaxed text-fg">{text}</code>
      </pre>
    </div>
  );
}

const HEADING_SIZE: Record<number, string> = {
  1: "text-heading-sm",
  2: "text-heading-sm",
  3: "text-label-lg font-semibold",
  4: "text-label-lg font-semibold",
  5: "text-label-md font-semibold",
  6: "text-label-md font-semibold",
};

// Memoized: chat renders one Markdown per message and re-renders the page on
// every streamed token — without memo, every historical message re-runs
// renderInline for all its blocks on every delta (O(history × tokens) work,
// visible as stream stutter).
const Markdown = React.memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  return (
    <div className={cn("flex flex-col gap-2.5 text-body-md text-fg [overflow-wrap:anywhere]", className)}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={i} text={block.text ?? ""} lang={block.lang} />;
          case "heading":
            return (
              <div key={i} className={cn(HEADING_SIZE[block.level ?? 1], "text-fg")}>
                {renderInline(block.text ?? "")}
              </div>
            );
          case "quote":
            return (
              <div key={i} className="border-l-2 border-line-strong pl-3 text-fg-muted">
                {renderInline(block.text ?? "")}
              </div>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items?.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {block.items?.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
              </ol>
            );
          default:
            return <p key={i}>{renderInline(block.text ?? "")}</p>;
        }
      })}
    </div>
  );
});

export { Markdown };
