import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowSquareOutIcon,
  ArrowsLeftRightIcon,
  BuildingsIcon,
  DotsThreeIcon,
  SignOutIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { Organisation, Project } from "@ai-studio/shared";
import { counted } from "../../lib/utils";
import { useWorkspace } from "../workspace-provider";
import { useMutation, useQuery } from "../../hooks/use-ipc-data";
import { ConfirmDialog } from "../confirm-dialog";
import { DeleteProjectDialog } from "../delete-project-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { FieldRow, ScopeHeader, SettingsRow, SettingsSection } from "./shared";
import { ProviderKeyRow } from "./providers";

// ─────────────────────────────────────────────────────────────────────────────
// Organization — overrides shared across the org's projects (placeholder)
// ─────────────────────────────────────────────────────────────────────────────

export function OrganizationSettings({
  org,
  orgs,
  projects,
}: {
  org: Organisation | undefined;
  orgs: Organisation[];
  projects: Project[];
}) {
  const navigate = useNavigate();
  const renameOrg = useMutation("org:rename");
  const deleteOrg = useMutation("org:delete");
  const setOrgKeys = useMutation("org:set-keys");
  const [name, setName] = useState(org?.name ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [impact, setImpact] = useState<{
    projects: number;
    spaces: number;
    chats: number;
    artifacts: number;
    memories: number;
  } | null>(null);
  const { data: orgKeys } = useQuery("org:keys", { id: org?.id ?? "" }, { enabled: !!org });

  if (!org) {
    return <p className="text-body-md text-fg-subtle">This organization no longer exists.</p>;
  }

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === org.name) {
      setName(org.name);
      return;
    }
    try {
      await renameOrg.mutate({ id: org.id, name: trimmed });
    } catch {
      toast.error("Couldn't rename organization");
    }
  };

  const openDeleteConfirm = async () => {
    try {
      setImpact(await window.ipc.invoke("org:impact", { id: org.id }));
    } catch {
      setImpact(null); // fall back to generic copy rather than blocking the dialog
    }
    setConfirmingDelete(true);
  };

  const deleteDescription = impact
    ? `"${org.name}" will be permanently deleted along with ${counted(impact.projects, "project")}, ${counted(impact.artifacts, "artifact")}, ${counted(impact.memories, "memory", "memories")} and ${counted(impact.chats, "chat")} — knowledge-graph entries included. This cannot be undone.`
    : `"${org.name}" and every project in it will be permanently deleted, knowledge-graph entries included. This cannot be undone.`;

  return (
    <>
      <ScopeHeader
        title={org.name}
        hint="Settings shared by every project in this organization."
      />

      <SettingsSection title="Projects" hint="Every project in this organization.">
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {projects.length === 0 && (
            <p className="px-4 py-3.5 text-body-sm text-fg-subtle">No projects yet.</p>
          )}
          {projects.map((project) => (
            <OrgProjectRow key={project.id} project={project} org={org} orgs={orgs} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Organization">
        <div className="mt-2 divide-y divide-line">
          <FieldRow label="Name" htmlFor="org-name">
            <Input
              id="org-name"
              className="w-72"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Organization name"
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="API keys"
        hint="Keys set here override the account's global keys for every chat in this organization's projects."
      >
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {/* Overriding providers float to the top. */}
          {Object.entries(orgKeys ?? {})
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .map(([provider, isSet]) => (
              <ProviderKeyRow
                key={provider}
                provider={provider}
                isSet={isSet}
                badge="Override"
                addLabel="Override"
                setHint="Overrides the global key for this organization's chats."
                unsetHint="Inherits the global key."
                onSave={async (value) => {
                  await setOrgKeys.mutate({ id: org.id, keys: { [provider]: value } });
                }}
                onClear={async () => {
                  await setOrgKeys.mutate({ id: org.id, keys: { [provider]: null } });
                }}
              />
            ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Danger zone">
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <SettingsRow
            danger
            icon={TrashIcon}
            title="Delete organization"
            description="Permanently delete this organization and every project in it."
            onClick={openDeleteConfirm}
          />
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete organization"
        description={deleteDescription}
        challenge="I understand, delete organization"
        onConfirm={async () => {
          const deleted = await deleteOrg.mutate({ id: org.id });
          if (!deleted) {
            toast.error("Can't delete this organization — it's the only one.");
            return;
          }
          navigate("/settings/general");
        }}
      />
    </>
  );
}

// One project of the org: click-through to its settings, ⋯ menu for the
// management actions. "Remove from organization" moves it to the first
// (seed/personal) org, so it never orphans — projects always have a home.
function OrgProjectRow({
  project,
  org,
  orgs,
}: {
  project: Project;
  org: Organisation;
  orgs: Organisation[];
}) {
  const navigate = useNavigate();
  const { setActiveOrgId, setActiveProjectId } = useWorkspace();
  const moveProject = useMutation("project:move");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const otherOrgs = orgs.filter((o) => o.id !== org.id);
  const personalOrg = orgs[0];

  const move = async (targetOrgId: string, targetName: string) => {
    try {
      await moveProject.mutate({ id: project.id, orgId: targetOrgId });
      toast.success(`Moved "${project.name}" to ${targetName}`);
    } catch {
      toast.error("Couldn't move project");
    }
  };

  const viewProject = () => {
    // Make it the workspace selection and go work in it.
    setActiveOrgId(org.id);
    setActiveProjectId(project.id);
    navigate("/");
  };

  return (
    <div className="group/orgproj flex items-center gap-1 pr-2 hover:bg-surface-2">
      <button
        type="button"
        onClick={() => navigate(`/settings/project/${project.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3 text-left"
      >
        {project.icon ? (
          <img src={project.icon} alt="" className="size-6 shrink-0 rounded-[6px] object-cover" />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-line bg-surface-2 text-label-sm font-semibold text-fg-muted">
            {project.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md text-fg">{project.name}</span>
          {project.description && (
            <span className="mt-0.5 block truncate text-body-sm text-fg-muted">
              {project.description}
            </span>
          )}
        </span>
      </button>

      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${project.name}`}
              className="opacity-0 focus-visible:opacity-100 group-hover/orgproj:opacity-100 data-[popup-open]:opacity-100"
            >
              <DotsThreeIcon size={16} weight="bold" />
            </Button>
          }
        />
        <MenuContent align="end">
          <MenuItem onClick={viewProject}>
            <ArrowSquareOutIcon />
            View project
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger disabled={otherOrgs.length === 0}>
              <ArrowsLeftRightIcon />
              Move to organization
            </MenuSubTrigger>
            <MenuSubContent>
              {otherOrgs.map((target) => (
                <MenuItem key={target.id} onClick={() => move(target.id, target.name)}>
                  <BuildingsIcon />
                  <span className="truncate">{target.name}</span>
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          {personalOrg && org.id !== personalOrg.id && (
            <MenuItem onClick={() => move(personalOrg.id, personalOrg.name)}>
              <SignOutIcon />
              Remove from organization
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon />
            Delete project
          </MenuItem>
        </MenuContent>
      </Menu>

      <DeleteProjectDialog
        project={project}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      />
    </div>
  );
}
