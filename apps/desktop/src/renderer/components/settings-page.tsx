import { Navigate, useLocation, useParams } from "react-router-dom";
import { cn } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import { useOrgs, useProjects, useQuery } from "../hooks/use-ipc-data";
import { SettingsNav } from "./settings/nav";
import { GeneralSettings } from "./settings/general";
import { ProviderModelsPage, ProvidersSettings } from "./settings/providers";
import { MCPSettings } from "./settings/mcp";
import { SkillsSettings } from "./settings/skills";
import { OrganizationSettings } from "./settings/organization";
import { ProjectSettings } from "./settings/project";

// ─────────────────────────────────────────────────────────────────────────────
// Settings — left nav is the full scaffold of the override cascade: General
// (app-wide) ▸ Organizations (every org) ▸ Projects (every project of the
// selected org). Browsing here is independent of the workspace's active
// org/project: routes carry the entity id (/settings/organization/:orgId,
// /settings/project/:projectId), and picking an org swaps the Projects group.
// The sidebar gear lands on General; the rail tile menu lands on its project.
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { orgId, projectId, provider } = useParams();
  const { pathname } = useLocation();
  const { activeOrgId } = useWorkspace();
  const { data: orgs = [] } = useOrgs();
  // Project pages fetch their own project — it also tells the nav which
  // org's projects to list, independent of the workspace selection.
  const { data: project } = useQuery(
    "project:get",
    { id: projectId! },
    { enabled: !!projectId },
  );

  const scope = projectId
    ? "project"
    : orgId
      ? "organization"
      : provider
        ? "provider-models"
        : pathname.endsWith("/providers")
          ? "providers"
          : pathname.endsWith("/mcp")
            ? "mcp"
            : pathname.endsWith("/skills")
              ? "skills"
              : "general";
  const navOrgId = orgId ?? project?.orgId ?? activeOrgId;
  const { data: projects = [] } = useProjects(navOrgId);

  return (
    <div className="flex h-full">
      <SettingsNav orgs={orgs} projects={projects} currentOrgId={navOrgId} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Skills rows carry mono names + full-sentence descriptions — they
            earn a wider column than the standard settings measure. */}
        <div className={cn("mx-auto px-10 py-10", scope === "skills" ? "max-w-3xl" : "max-w-2xl")}>
          {scope === "general" && <GeneralSettings />}
          {scope === "providers" && <ProvidersSettings />}
          {scope === "provider-models" && <ProviderModelsPage key={provider} provider={provider!} />}
          {scope === "mcp" && <MCPSettings />}
          {scope === "skills" && <SkillsSettings />}
          {scope === "organization" && (
            <OrganizationSettings
              key={orgId}
              org={orgs.find((o) => o.id === orgId)}
              orgs={orgs}
              projects={projects}
            />
          )}
          {scope === "project" &&
            (project ? (
              // Key by project so field state resets when switching projects.
              <ProjectSettings key={project.id} project={project} />
            ) : project === null ? (
              <p className="text-body-md text-fg-subtle">This project no longer exists.</p>
            ) : null)}
        </div>
      </div>
    </div>
  );
}

/** Legacy `/settings/project` links land on the active project's settings. */
export function ProjectSettingsRedirect() {
  const { activeProjectId } = useWorkspace();
  return (
    <Navigate
      to={activeProjectId ? `/settings/project/${activeProjectId}` : "/settings/general"}
      replace
    />
  );
}
