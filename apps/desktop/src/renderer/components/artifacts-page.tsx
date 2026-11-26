import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  CubeIcon,
  DotsThreeIcon,
  FileCodeIcon,
  FileCsvIcon,
  FileDocIcon,
  FilePdfIcon,
  FileTextIcon,
  FileXlsIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn, counted } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import { invalidateQueries, useArtifact, useArtifacts, useMutation } from "../hooks/use-ipc-data";
import { Button } from "./ui/button";
import { Markdown } from "./ui/markdown";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";
import { ConfirmDialog } from "./confirm-dialog";
import { NameDialog } from "./name-dialog";
import { Skeleton } from "./ui/skeleton";
import { PdfViewer } from "./viewers/pdf-viewer";
import { DocxViewer } from "./viewers/docx-viewer";
import { SheetViewer, TableViewer } from "./viewers/table-viewer";

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts — a project's document library. Two provenances share one shelf:
// agent-extracted artifacts (code/prd/plan/…) whose content is the text itself,
// and uploaded documents (with the original bytes kept for PDF/DOCX/XLSX).
// Master list on the left, a type-aware viewer on the right. Every format the
// app understands renders in-app, in the app's own chrome: PDFs via pdf.js,
// Word docs via mammoth HTML, spreadsheets/CSV as tables, prose as markdown.
// Preserved originals we can't render fall back to their extracted text plus
// an "open the original" escape hatch. Project-scoped — uploads happen in
// chat, so this page reads/manages, it doesn't ingest.
// ─────────────────────────────────────────────────────────────────────────────

type ArtifactListItem = ReturnType<typeof useArtifacts>["data"] extends (infer T)[] | undefined
  ? T
  : never;

const PROSE_TYPES = new Set(["prd", "plan", "architecture", "research"]);

/** Which viewer to mount for a fully-loaded artifact. */
type ViewKind = "pdf" | "docx" | "sheet" | "csv" | "tsv" | "office" | "markdown" | "code";
function viewKindFor(a: { type: string; source: string; mime: string | null; blobPath: string | null }): ViewKind {
  if (a.mime === "application/pdf") return "pdf";
  if (a.mime?.includes("wordprocessingml") && a.blobPath) return "docx";
  if (a.mime?.includes("spreadsheetml") || a.mime?.includes("ms-excel")) return "sheet";
  if (a.mime === "text/csv") return "csv";
  if (a.mime === "text/tab-separated-values") return "tsv";
  // Uploaded original we kept bytes for but have no dedicated viewer for.
  if (a.source === "upload" && a.blobPath) return "office";
  if (a.type === "code") return "code";
  if (PROSE_TYPES.has(a.type) || a.mime === "text/markdown") return "markdown";
  // Uploaded plain text / json: show it raw rather than markdown-mangled.
  if (a.source === "upload") return "code";
  return "markdown";
}

export function listIcon(a: { type: string; mime: string | null }): Icon {
  if (a.mime === "application/pdf") return FilePdfIcon;
  if (a.mime?.includes("word")) return FileDocIcon;
  if (a.mime?.includes("sheet") || a.mime?.includes("excel")) return FileXlsIcon;
  if (a.mime === "text/csv" || a.mime === "text/tab-separated-values") return FileCsvIcon;
  if (a.type === "code") return FileCodeIcon;
  if (a.type === "document") return FileTextIcon;
  return CubeIcon;
}

const TYPE_LABEL: Record<string, string> = {
  code: "Code",
  prd: "PRD",
  plan: "Plan",
  architecture: "Architecture",
  research: "Research",
  document: "Document",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────

export function ArtifactsPage() {
  const { activeProjectId, activeProject } = useWorkspace();
  const { data: artifacts, loading, error, refetch } = useArtifacts(activeProjectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep a valid selection as the list changes (first by default; drop a
  // selection that was deleted).
  useEffect(() => {
    if (!artifacts) return;
    if (artifacts.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[0]!.id);
    }
  }, [artifacts, selectedId]);

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line">
        <header className="px-4 pb-2 pt-9">
          <h1 className="text-heading-sm text-fg">Artifacts</h1>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {activeProject?.name ?? "Project"} ·{" "}
            {artifacts ? counted(artifacts.length, "artifact") : "…"}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="space-y-1 px-2 py-1">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-4/5" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-start gap-2 px-2 py-2">
              <p className="text-body-sm text-danger-text">Couldn&apos;t load artifacts.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : !artifacts?.length ? (
            <p className="px-2 py-2 text-body-sm text-fg-subtle">
              No artifacts yet. They appear as chats generate documents or you attach files.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {artifacts.map((a) => (
                <ArtifactRow
                  key={a.id}
                  artifact={a}
                  active={a.id === selectedId}
                  onSelect={() => setSelectedId(a.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-hidden">
        {selectedId ? (
          <ArtifactViewer key={selectedId} id={selectedId} onDeleted={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-body-md text-fg-subtle">
              {artifacts?.length ? "Select an artifact." : "Nothing to show yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactRow({
  artifact,
  active,
  onSelect,
}: {
  artifact: ArtifactListItem;
  active: boolean;
  onSelect: () => void;
}) {
  const IconComponent = listIcon(artifact);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "pressable flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
          active ? "bg-surface-2 text-fg shadow-raised" : "text-fg-muted hover:bg-surface-1 hover:text-fg",
        )}
      >
        <IconComponent size={18} className={cn("shrink-0", active ? "text-fg" : "text-fg-subtle")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md">{artifact.title}</span>
          <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
            {typeLabel(artifact.type)} · {fmtWhen(artifact.updatedAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer
// ─────────────────────────────────────────────────────────────────────────────

function ArtifactViewer({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data: artifact, loading, error } = useArtifact(id);
  const updateArtifact = useMutation("artifact:update");
  const renameArtifact = useMutation("artifact:rename");
  const deleteArtifact = useMutation("artifact:delete");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  // Leaving edit mode whenever the artifact changes keeps a stale draft from
  // bleeding across a selection switch.
  useEffect(() => {
    setEditing(false);
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-3 p-10">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  if (error || !artifact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-md text-danger-text">
          {error ? "Couldn't load this artifact." : "This artifact no longer exists."}
        </p>
      </div>
    );
  }

  const kind = viewKindFor(artifact);
  // Editable = the content IS the artifact (prose, code, delimited text).
  // Rendered-from-blob views (pdf/docx/sheet) aren't text to edit.
  const editable = kind === "markdown" || kind === "code" || kind === "csv" || kind === "tsv";
  const hasOriginal = artifact.source === "upload" && !!artifact.blobPath;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const save = () => {
    updateArtifact
      .mutate({ id, content: draft })
      .then(() => setEditing(false))
      .catch(() => toast.error("Couldn't save changes"));
  };

  const openExternal = async () => {
    const ok = await window.ipc.invoke("artifact:open-external", { id });
    if (!ok) toast.error("Couldn't open the original file");
  };
  const reveal = async () => {
    const ok = await window.ipc.invoke("artifact:reveal", { id });
    if (!ok) toast.error("Couldn't reveal the original file");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-heading-sm text-fg">{artifact.title}</h2>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {typeLabel(artifact.type)}
            {artifact.source === "upload" ? " · uploaded" : " · generated"}
            {artifact.version > 1 ? ` · v${artifact.version}` : ""}
            {` · ${fmtWhen(artifact.updatedAt)}`}
          </p>
        </div>

        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={updateArtifact.loading}>
              Save
            </Button>
          </>
        ) : (
          <>
            {hasOriginal && (
              <Button variant="outline" size="sm" onClick={openExternal}>
                <ArrowSquareOutIcon size={15} />
                Open original
              </Button>
            )}
            {editable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(artifact.content);
                  setEditing(true);
                }}
              >
                <PencilSimpleIcon size={15} />
                Edit
              </Button>
            )}
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Artifact actions" />}>
                <DotsThreeIcon size={18} weight="bold" />
              </MenuTrigger>
              <MenuContent>
                <MenuItem onClick={copy}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy text"}
                </MenuItem>
                <MenuItem onClick={() => setRenaming(true)}>
                  <PencilSimpleIcon />
                  Rename
                </MenuItem>
                {hasOriginal && (
                  <MenuItem onClick={reveal}>
                    <FolderOpenIcon />
                    Reveal in file manager
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem
                  className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <TrashIcon />
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-6 font-mono text-body-sm leading-relaxed text-fg outline-none"
          />
        ) : (
          <ArtifactBody kind={kind} artifact={artifact} onOpenExternal={openExternal} onReveal={reveal} />
        )}
      </div>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename artifact"
        placeholder="Artifact title"
        initialValue={artifact.title}
        onSubmit={async (title) => {
          await renameArtifact.mutate({ id, title }).catch(() => toast.error("Couldn't rename"));
        }}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete "${artifact.title}"?`}
        description="It's removed from this project and any branch that attached it. This can't be undone from here."
        onConfirm={async () => {
          await deleteArtifact.mutate({ id });
          invalidateQueries();
          onDeleted();
        }}
      />
    </div>
  );
}

function ArtifactBody({
  kind,
  artifact,
  onOpenExternal,
  onReveal,
}: {
  kind: ViewKind;
  artifact: NonNullable<ReturnType<typeof useArtifact>["data"]>;
  onOpenExternal: () => void;
  onReveal: () => void;
}) {
  // Escape hatch for preserved originals we can't (or failed to) render:
  // extracted text plus the original file. Also the fallback the docx and
  // sheet viewers hand back to when their conversion comes up empty.
  const officeFallback = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-surface-2 px-6 py-3">
        <p className="text-body-sm text-fg-muted">
          This format can&apos;t be previewed here — showing extracted text. Open the original for full
          fidelity.
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" onClick={onOpenExternal}>
            <ArrowSquareOutIcon size={15} />
            Open
          </Button>
          <Button variant="ghost" size="sm" onClick={onReveal}>
            <FolderOpenIcon size={15} />
            Reveal
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <pre className="whitespace-pre-wrap break-words font-mono text-body-sm leading-relaxed text-fg-muted">
          {artifact.content}
        </pre>
      </div>
    </div>
  );

  if (kind === "pdf") return <PdfViewer id={artifact.id} />;
  if (kind === "docx") return <DocxViewer id={artifact.id} fallback={officeFallback} />;
  if (kind === "sheet") return <SheetViewer content={artifact.content} fallback={officeFallback} />;
  if (kind === "csv" || kind === "tsv") {
    return <TableViewer text={artifact.content} delimiter={kind === "tsv" ? "\t" : ","} />;
  }
  if (kind === "office") return officeFallback;

  if (kind === "code") {
    return (
      <div className="h-full overflow-auto p-6">
        <pre className="whitespace-pre-wrap break-words font-mono text-body-sm leading-relaxed text-fg">
          {artifact.content}
        </pre>
      </div>
    );
  }

  // markdown
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <Markdown text={artifact.content} />
      </div>
    </div>
  );
}

