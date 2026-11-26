import { useState } from "react";
import { toast } from "sonner";
import {
  BuildingsIcon,
  NoteIcon,
  PaintBrushIcon,
  PlugsIcon,
  PlusIcon,
  ScalesIcon,
  TagIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { KnowledgeEntryInfo } from "@squirl/event-bus";
import { useWorkspace } from "./workspace-provider";
import { useKnowledgeBase, useMutation } from "../hooks/use-ipc-data";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Input, Textarea } from "./ui/input";
import { Markdown } from "./ui/markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ConfirmDialog } from "./confirm-dialog";

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge base — manually (or agent-) authored project notes: architecture
// decisions, style conventions, API contracts, gotchas. Distinct from Memory
// (auto-detected facts fed to every turn) and the Knowledge graph (the
// classifier's auto-extracted, embedding-linked decisions) — this is the
// deliberate, curated shelf, closer to a project wiki than a context feed.
// Backend: `kb_write`/`kb_read` tools + kb:list/add/remove IPC, both keyed to
// this project's own note store (see main/ipc/knowledge.ts).
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES: KnowledgeEntryInfo["category"][] = [
  "architecture",
  "style",
  "api",
  "gotcha",
  "decision",
  "note",
];

const CATEGORY_ICON: Record<KnowledgeEntryInfo["category"], Icon> = {
  architecture: BuildingsIcon,
  style: PaintBrushIcon,
  api: PlugsIcon,
  gotcha: WarningIcon,
  decision: ScalesIcon,
  note: NoteIcon,
};

const CATEGORY_LABEL: Record<KnowledgeEntryInfo["category"], string> = {
  architecture: "Architecture",
  style: "Style",
  api: "API",
  gotcha: "Gotcha",
  decision: "Decision",
  note: "Note",
};

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function KnowledgeBasePage() {
  const { activeProjectId } = useWorkspace();
  const [category, setCategory] = useState<KnowledgeEntryInfo["category"] | "all">("all");
  const { data: entries, loading, refetch } = useKnowledgeBase(
    activeProjectId,
    category === "all" ? undefined : category,
  );
  const [viewing, setViewing] = useState<KnowledgeEntryInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [doomed, setDoomed] = useState<KnowledgeEntryInfo | null>(null);
  const removeEntry = useMutation("kb:remove");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-10 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-heading-md text-fg">Knowledge base</h1>
            <p className="mt-1 text-body-md text-fg-muted">
              Notes the agent keeps about this project — architecture, style, gotchas, decisions.
            </p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> New note
          </Button>
        </header>

        <div className="mt-6 flex flex-wrap gap-1.5">
          <CategoryChip active={category === "all"} onClick={() => setCategory("all")} label="All" />
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              active={category === c}
              onClick={() => setCategory(c)}
              label={CATEGORY_LABEL[c]}
              icon={CATEGORY_ICON[c]}
            />
          ))}
        </div>

        <div className="mt-6">
          {loading && !entries ? null : !entries?.length ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-line">
              <p className="max-w-sm text-center text-body-sm text-fg-subtle">
                {category === "all"
                  ? "No notes yet — add one, or ask the agent to save one (\"remember that we use Postgres for the analytics service\")."
                  : `No ${CATEGORY_LABEL[category].toLowerCase()} notes yet.`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {entries.map((entry) => {
                const Icon = CATEGORY_ICON[entry.category];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setViewing(entry)}
                    className="flex min-h-14 w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-100 hover:bg-surface-1"
                  >
                    <Icon size={18} className="shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label-md text-fg">{entry.title}</span>
                      <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
                        {CATEGORY_LABEL[entry.category]}
                        {entry.tags.length > 0 && ` · ${entry.tags.join(", ")}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                      {fmtWhen(entry.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AddNoteDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={activeProjectId}
        onAdded={() => refetch()}
      />

      {/* A Drawer, not a Dialog: a note's full content is a reference
          document to read, same rule as the Skills page's instructions view. */}
      <Drawer open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DrawerContent className="w-[520px]">
          {viewing && (
            <>
              <DrawerHeader className="border-b border-line">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{CATEGORY_LABEL[viewing.category]}</Badge>
                  {viewing.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      <TagIcon size={12} /> {t}
                    </Badge>
                  ))}
                </div>
                <DrawerTitle className="mt-1">{viewing.title}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="py-4">
                <Markdown text={viewing.content} />
              </DrawerBody>
              <DrawerFooter className="border-t border-line">
                <span className="mr-auto text-body-sm text-fg-subtle">
                  Updated {new Date(viewing.updatedAt).toLocaleString()}
                </span>
                <Button variant="danger" size="sm" onClick={() => setDoomed(viewing)}>
                  <TrashIcon /> Delete
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(open) => { if (!open) setDoomed(null); }}
        title="Delete note?"
        description={`"${doomed?.title}" will be permanently removed from the knowledge base.`}
        onConfirm={async () => {
          if (!doomed || !activeProjectId) return;
          try {
            await removeEntry.mutate({ projectId: activeProjectId, id: doomed.id });
            setViewing(null);
            refetch();
          } catch {
            toast.error("Couldn't delete note");
          }
          setDoomed(null);
        }}
      />
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: Icon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-label-sm transition-colors duration-100 ${
        active
          ? "border-line-strong bg-surface-2 text-fg"
          : "border-line bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {Icon && <Icon size={13} />}
      {label}
    </button>
  );
}

function AddNoteDialog({
  open,
  onOpenChange,
  projectId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | undefined;
  onAdded: () => void;
}) {
  const addEntry = useMutation("kb:add");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<KnowledgeEntryInfo["category"]>("note");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setContent("");
    setCategory("note");
    setTags("");
  };

  const submit = async () => {
    if (!projectId || !title.trim() || !content.trim() || busy) return;
    setBusy(true);
    try {
      await addEntry.mutate({
        projectId,
        title: title.trim(),
        content: content.trim(),
        category,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onAdded();
      onOpenChange(false);
      reset();
    } catch {
      toast.error("Couldn't save note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle>New note</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Select items={CATEGORY_LABEL} value={category} onValueChange={(v) => setCategory(v as KnowledgeEntryInfo["category"])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Content (markdown supported)"
            className="min-h-32"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <Input
            placeholder="Tags, comma separated (optional)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim() || !content.trim() || busy}>
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
