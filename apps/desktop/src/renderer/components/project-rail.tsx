import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GearIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { Project } from "@ai-studio/shared";
import { cn } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import { useMutation } from "../hooks/use-ipc-data";
import { NameDialog } from "./name-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// ─────────────────────────────────────────────────────────────────────────────
// Project rail — far-left column of the active org's projects. Neutral
// initial tiles (color means state, not category); active tile is raised.
// Tiles carry the project's management context menu and drag to reorder.
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectRail() {
  const { projects, activeOrgId, activeProjectId, setActiveProjectId } = useWorkspace();
  const createProject = useMutation("project:create");
  const reorderProjects = useMutation("project:reorder");
  const [creating, setCreating] = useState(false);
  // Live order while a tile is being dragged; null when no drag is happening.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const displayProjects = dragOrder
    ? (dragOrder
        .map((id) => projects.find((p) => p.id === id))
        .filter(Boolean) as Project[])
    : projects;

  const startDrag = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    setDragOrder(projects.map((p) => p.id));
    e.dataTransfer.effectAllowed = "move";
  };

  // Reorder live as the dragged tile passes over siblings, so the rail
  // previews the result instead of showing an abstract drop indicator.
  const dragOver = (overId: string) => () => {
    if (!dragId || dragId === overId) return;
    setDragOrder((order) => {
      if (!order) return order;
      const from = order.indexOf(dragId);
      const to = order.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return order;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      return next;
    });
  };

  const endDrag = async () => {
    const order = dragOrder;
    setDragId(null);
    setDragOrder(null);
    if (!order || !activeOrgId) return;
    if (order.join() === projects.map((p) => p.id).join()) return;
    try {
      await reorderProjects.mutate({ orgId: activeOrgId, ids: order });
    } catch {
      toast.error("Couldn't save the new project order");
    }
  };

  return (
    <div
      className="flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line pb-2 pt-0.5"
      onDragOver={(e) => e.preventDefault()}
    >
      {displayProjects.map((project) => (
        <ProjectTile
          key={project.id}
          project={project}
          active={project.id === activeProjectId}
          dragging={project.id === dragId}
          onSelect={() => setActiveProjectId(project.id)}
          onDragStart={startDrag(project.id)}
          onDragEnter={dragOver(project.id)}
          onDragEnd={endDrag}
        />
      ))}

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New project"
              onClick={() => setCreating(true)}
              className="pressable flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-line text-fg-subtle hover:border-line-strong hover:bg-surface-1 hover:text-fg"
            >
              <PlusIcon size={16} />
            </button>
          }
        />
        <TooltipContent side="right">New project</TooltipContent>
      </Tooltip>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New project"
        placeholder="Project name"
        onSubmit={async (name) => {
          if (!activeOrgId) return;
          const project = await createProject.mutate({ orgId: activeOrgId, name });
          setActiveProjectId(project.id);
        }}
      />
    </div>
  );
}

function ProjectTile({
  project,
  active,
  dragging,
  onSelect,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: {
  project: Project;
  active: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}) {
  const navigate = useNavigate();
  const renameProject = useMutation("project:rename");
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <ContextMenu>
        {/* While this tile's menu is open, hold its hover state so it's
            obvious which project the menu belongs to. */}
        <ContextMenuTrigger className="group/project block shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={project.name}
                  aria-pressed={active}
                  draggable
                  onClick={onSelect}
                  onDragStart={onDragStart}
                  onDragEnter={onDragEnter}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnd={onDragEnd}
                  className={cn(
                    "pressable flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md text-label-lg font-semibold",
                    active
                      ? "border border-line-strong bg-surface-2 text-fg shadow-raised"
                      : "text-fg-muted hover:bg-surface-1 hover:text-fg",
                    "group-data-[popup-open]/project:bg-surface-1 group-data-[popup-open]/project:text-fg",
                    dragging && "opacity-40",
                  )}
                >
                  {project.icon ? (
                    <img
                      src={project.icon}
                      alt=""
                      draggable={false}
                      className="size-full object-cover"
                    />
                  ) : (
                    project.name.slice(0, 1).toUpperCase()
                  )}
                </button>
              }
            />
            <TooltipContent side="right">{project.name}</TooltipContent>
          </Tooltip>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel className="max-w-52 truncate">{project.name}</ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <PencilSimpleIcon />
            Rename
          </ContextMenuItem>
          {/* Settings routes carry the project id, so this needn't switch the
              workspace's active project just to view settings. */}
          <ContextMenuItem onClick={() => navigate(`/settings/project/${project.id}`)}>
            <GearIcon />
            Settings
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename project"
        placeholder="Project name"
        submitLabel="Rename"
        initialValue={project.name}
        onSubmit={async (name) => {
          await renameProject.mutate({ id: project.id, name });
        }}
      />
      <DeleteProjectDialog
        project={project}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        // The workspace provider re-defaults to the first remaining project;
        // leave any route that pointed into the deleted one.
        onDeleted={() => {
          if (active) navigate("/");
        }}
      />
    </>
  );
}
