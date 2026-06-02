import { ChevronRight } from "lucide-react";

export function RightPanel() {
  return (
    <aside className="w-64 shrink-0 border-l border-border bg-background p-3 space-y-2">
      <PanelSection title="Context" />
      <PanelSection title="Memories" />
      <PanelSection title="Artifacts" defaultOpen>
        <div className="space-y-1 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded border-input" /> API Documentation
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded border-input" defaultChecked /> Business requirement document
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded border-input" /> Design system
          </label>
        </div>
      </PanelSection>
      <PanelSection title="Usage" />
    </aside>
  );
}

function PanelSection({ title, children, defaultOpen = false }: { title: string; children?: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-md border border-border">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
        {title}
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
      </summary>
      {children && <div className="px-3 pb-2">{children}</div>}
    </details>
  );
}
