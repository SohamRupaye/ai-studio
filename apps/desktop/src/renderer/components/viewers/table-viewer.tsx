import { useMemo } from "react";
import type { ReactNode } from "react";
import { counted } from "../../lib/utils";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { parseDelimited, parseSheets } from "./parse-delimited";

// In-app tabular viewer: CSV/TSV artifacts (whose content IS the original
// file) and spreadsheet artifacts (whose extracted text is ingestion's
// "## Sheet: name" + CSV sections) render as real tables instead of raw text.

/** Keeps a million-row export from wedging the renderer; the footer says so. */
const MAX_ROWS = 2000;

/** First row is the header; the rest render capped at MAX_ROWS. */
function DataTable({ rows }: { rows: string[][] }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1, MAX_ROWS + 1);
  const truncated = rows.length - 1 > MAX_ROWS;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-body-sm">
          <thead className="sticky top-0 z-10">
            {/* inset shadow instead of border-b: borders don't travel with a sticky thead */}
            <tr className="bg-surface-2 shadow-[inset_0_-1px_0_var(--line)]">
              <th className="w-12 px-3 py-2 text-right text-label-sm font-medium text-fg-subtle" />
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2 text-left text-label-sm font-medium text-fg-muted"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {body.map((row, i) => (
              <tr key={i} className="hover:bg-surface-1">
                <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-fg-subtle">
                  {i + 1}
                </td>
                {header.map((_, j) => (
                  <td key={j} className="max-w-96 truncate px-3 py-1.5 align-top" title={row[j]}>
                    {row[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-4 py-1.5 text-body-sm text-fg-subtle">
        <span className="tabular-nums">
          {counted(rows.length - 1, "row")} · {counted(header.length, "column")}
        </span>
        {truncated && <span>Showing the first {MAX_ROWS.toLocaleString()} rows.</span>}
      </footer>
    </div>
  );
}

/** CSV / TSV artifact — the content is the file, parse it straight. */
export function TableViewer({ text, delimiter }: { text: string; delimiter: "," | "\t" }) {
  const rows = useMemo(() => parseDelimited(text.trim(), delimiter), [text, delimiter]);
  if (!rows.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-md text-fg-subtle">This file has no rows.</p>
      </div>
    );
  }
  return <DataTable rows={rows} />;
}

/** Spreadsheet artifact — one tab per sheet; single sheets skip the tab bar. */
export function SheetViewer({ content, fallback }: { content: string; fallback: ReactNode }) {
  const sheets = useMemo(() => parseSheets(content), [content]);

  // Content that doesn't carry ingestion's sheet markers (or parses empty) —
  // hand back to the extracted-text fallback instead of a blank table.
  if (!sheets.length) return <>{fallback}</>;
  if (sheets.length === 1) return <DataTable rows={sheets[0]!.rows} />;

  return (
    <Tabs defaultValue={sheets[0]!.name} className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line bg-surface-1 px-4 py-2">
        <TabsList>
          {sheets.map((s) => (
            <TabsTab key={s.name} value={s.name}>
              {s.name}
            </TabsTab>
          ))}
        </TabsList>
      </div>
      {sheets.map((s) => (
        <TabsPanel key={s.name} value={s.name} className="min-h-0 flex-1">
          <DataTable rows={s.rows} />
        </TabsPanel>
      ))}
    </Tabs>
  );
}
