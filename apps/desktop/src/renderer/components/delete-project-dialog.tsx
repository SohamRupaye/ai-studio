import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Project } from "@squirl/shared";
import { counted } from "../lib/utils";
import { useMutation } from "../hooks/use-ipc-data";
import { ConfirmDialog } from "./confirm-dialog";

// The app's one irreversible delete: DB rows (soft-deleted included), scoped
// memories and knowledge-graph nodes all go. Counted description + typed
// challenge. Shared by the rail tile menu and the project settings page.
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const deleteProject = useMutation("project:delete");
  const [impact, setImpact] = useState<{
    spaces: number;
    chats: number;
    artifacts: number;
    memories: number;
  } | null>(null);

  // Count the contents when the dialog opens — the confirm should say what
  // it costs. On failure fall back to generic copy rather than blocking.
  useEffect(() => {
    if (!open) return;
    setImpact(null);
    window.ipc
      .invoke("project:impact", { id: project.id })
      .then(setImpact)
      .catch(() => setImpact(null));
  }, [open, project.id]);

  const description = impact
    ? `"${project.name}" will be permanently deleted along with ${counted(impact.spaces, "space")}, ${counted(impact.artifacts, "artifact")}, ${counted(impact.memories, "memory", "memories")}, ${counted(impact.chats, "chat")} and its knowledge-graph entries. This cannot be undone.`
    : `"${project.name}" and everything in it will be permanently deleted, including its knowledge-graph entries. This cannot be undone.`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete project"
      description={description}
      challenge="I understand, delete project"
      onConfirm={async () => {
        const deleted = await deleteProject.mutate({ id: project.id });
        if (!deleted) {
          toast.error("Couldn't delete project");
          return;
        }
        onDeleted?.();
      }}
    />
  );
}
