import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";

// In-app Word viewer: the preserved .docx original converted to HTML in the
// main process (mammoth) and typeset with the app's own type scale — a native
// reading view instead of the "can't preview, here's raw text" banner.
// mammoth emits a fixed tag whitelist with all text escaped, so injecting its
// output is safe; the CSP (script-src 'self') backstops it regardless.

// Document typography, scoped to mammoth's output tags. Mirrors the Markdown
// component's scale so generated and uploaded documents read as one family.
const DOCX_PROSE = cn(
  "text-body-md leading-relaxed text-fg [overflow-wrap:anywhere]",
  "[&_p]:my-2.5",
  "[&_h1]:mb-2 [&_h1]:mt-7 [&_h1]:text-heading-md [&_h1]:text-fg",
  "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-heading-sm [&_h2]:text-fg",
  "[&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-label-lg [&_h3]:font-semibold [&_h3]:text-fg",
  "[&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:text-label-md [&_h4]:font-semibold [&_h4]:text-fg",
  "[&_h5]:mb-1 [&_h5]:mt-3 [&_h5]:text-label-md [&_h5]:font-semibold [&_h5]:text-fg-muted",
  "[&_h6]:mb-1 [&_h6]:mt-3 [&_h6]:text-label-sm [&_h6]:font-semibold [&_h6]:text-fg-muted",
  "[&_strong]:font-semibold [&_strong]:text-fg",
  "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-line-strong hover:[&_a]:decoration-fg-muted",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-body-sm",
  "[&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top",
  "[&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-label-sm [&_th]:text-fg-muted",
  "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
  "[&_hr]:my-5 [&_hr]:border-line",
);

export function DocxViewer({ id, fallback }: { id: string; fallback: ReactNode }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    window.ipc
      .invoke("artifact:docx-html", { id })
      .then((res) => {
        if (cancelled) return;
        if (res) setHtml(res.html);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Conversion can fail (corrupt file, blob gone) — show the extracted-text
  // fallback rather than a dead end.
  if (failed) return <>{fallback}</>;

  if (html === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-fg-subtle">
        <Spinner size="sm" />
        <span className="text-body-sm">Preparing document…</span>
      </div>
    );
  }

  // Links open in the OS browser (the window-open handler routes them to
  // shell.openExternal); in-document anchors (#footnote) keep default
  // navigation so footnote references still jump.
  const onClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href || href.startsWith("#")) return;
    e.preventDefault();
    window.open(href);
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      {/* eslint-disable-next-line react/no-danger -- mammoth output, see header comment */}
      <div
        className={cn("mx-auto max-w-3xl", DOCX_PROSE)}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
