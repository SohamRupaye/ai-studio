import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  BrainIcon,
  CaretRightIcon,
  CubeIcon,
  TerminalWindowIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { Project } from "@squirl/shared";
import { useMutation } from "../../hooks/use-ipc-data";
import { DeleteProjectDialog } from "../delete-project-dialog";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { FieldRow, ScopeHeader, SettingsRow, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Project — a project's identity, context and danger zone
// ─────────────────────────────────────────────────────────────────────────────

/** Cover-crop an image file to a small square data URL for the rail tile. */
async function fileToIconDataUrl(file: File, size = 128): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    const crop = Math.min(img.width, img.height);
    ctx.drawImage(
      img,
      (img.width - crop) / 2,
      (img.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      size,
      size,
    );
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProjectSettings({ project }: { project: Project }) {
  const navigate = useNavigate();
  const updateProject = useMutation("project:update");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (patch: Parameters<typeof updateProject.mutate>[0], failMessage: string) => {
    try {
      await updateProject.mutate(patch);
    } catch {
      toast.error(failMessage);
    }
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) {
      setName(project.name); // revert empty/unchanged input
      return;
    }
    save({ id: project.id, name: trimmed }, "Couldn't rename project");
  };

  const saveDescription = () => {
    if (description === (project.description ?? "")) return;
    save({ id: project.id, description }, "Couldn't save description");
  };

  const saveSystemPrompt = () => {
    if (systemPrompt === (project.systemPrompt ?? "")) return;
    save({ id: project.id, systemPrompt }, "Couldn't save system prompt");
  };

  const pickIcon = async (file: File | undefined) => {
    if (!file) return;
    let icon: string;
    try {
      icon = await fileToIconDataUrl(file);
    } catch {
      toast.error("Couldn't read that image");
      return;
    }
    save({ id: project.id, icon }, "Couldn't save icon");
  };

  return (
    <>
      <ScopeHeader
        title={project.name}
        hint="Everything here applies to this project only. Changes save as you go."
      />

      <SettingsSection title="Identity" hint="How this project appears across the app.">
        <div className="mt-2 divide-y divide-line">
          <FieldRow label="Icon" hint="Shown on the project rail.">
            <div className="flex items-center gap-2">
              {project.icon && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => save({ id: project.id, icon: null }, "Couldn't remove icon")}
                >
                  Remove
                </Button>
              )}
              <button
                type="button"
                aria-label="Upload project icon"
                onClick={() => fileRef.current?.click()}
                className="pressable group relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 text-label-lg font-semibold text-fg-muted shadow-raised hover:border-line-strong"
              >
                {project.icon ? (
                  <img src={project.icon} alt="" className="size-full object-cover" />
                ) : (
                  project.name.slice(0, 1).toUpperCase()
                )}
                <span className="absolute inset-0 hidden items-center justify-center bg-canvas/70 group-hover:flex">
                  <UploadSimpleIcon size={16} className="text-fg" />
                </span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickIcon(e.target.files?.[0]);
                e.target.value = ""; // allow re-picking the same file
              }}
            />
          </FieldRow>

          <FieldRow label="Name" htmlFor="project-name">
            <Input
              id="project-name"
              className="w-72"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Project name"
            />
          </FieldRow>

          <FieldRow
            label="Description"
            htmlFor="project-description"
            hint="What this project is about."
            align="start"
          >
            <Textarea
              id="project-description"
              className="w-72"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              placeholder="Optional"
              rows={3}
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection title="Manage" hint="The project's accumulated context and behaviour.">
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          <SettingsRow
            icon={CubeIcon}
            title="Manage artifacts"
            description="Everything this project's chats have produced."
            onClick={() => navigate("/artifacts")}
          />
          <SettingsRow
            icon={BrainIcon}
            title="Manage memories"
            description="Facts saved for this project and its chats."
            onClick={() => navigate("/memories")}
          />

          {/* Expands in place — trailing caret rotates down instead of the
              navigation chevron, keeping the icon column aligned. */}
          <Collapsible>
            <CollapsibleTrigger
              caret={false}
              className="w-full gap-3.5 rounded-none px-4 py-3.5 hover:bg-surface-2"
            >
              <TerminalWindowIcon size={18} className="shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-label-md text-fg">Customize system prompt</span>
                <span className="mt-0.5 block text-body-sm text-fg-muted">
                  Instructions added to every chat in this project.
                </span>
              </span>
              <CaretRightIcon
                size={14}
                className="shrink-0 text-fg-subtle transition-transform duration-200 ease-(--ease-standard) group-data-[panel-open]/collapsible:rotate-90"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="px-4 pb-4 pt-1">
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  onBlur={saveSystemPrompt}
                  placeholder={`e.g. "Answers concern our design system — prefer its tokens and components over ad-hoc CSS."`}
                  rows={5}
                />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </SettingsSection>

      <SettingsSection title="Danger zone">
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <SettingsRow
            danger
            icon={TrashIcon}
            title="Delete project"
            description="Permanently delete this project and everything in it."
            onClick={() => setConfirmingDelete(true)}
          />
        </div>
      </SettingsSection>

      <DeleteProjectDialog
        project={project}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        // Stay in settings, one scope up — the deleted project's org.
        onDeleted={() => navigate(`/settings/organization/${project.orgId}`)}
      />
    </>
  );
}
