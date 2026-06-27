import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Organisation, Project } from "@ai-studio/shared";
import { useOrgs, useProjects } from "../hooks/use-ipc-data";

// ─────────────────────────────────────────────────────────────────────────────
// Workspace context — tracks the active organisation + project.
// Persists selection to localStorage; defaults to the first available.
// ─────────────────────────────────────────────────────────────────────────────

interface WorkspaceContextValue {
  orgs: Organisation[];
  projects: Project[];
  activeOrg: Organisation | undefined;
  activeProject: Project | undefined;
  activeOrgId: string | undefined;
  activeProjectId: string | undefined;
  setActiveOrgId: (id: string) => void;
  setActiveProjectId: (id: string) => void;
  loading: boolean;
  refetchOrgs: () => Promise<void>;
  refetchProjects: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const ORG_KEY = "ai-studio:active-org";
const PROJECT_KEY = "ai-studio:active-project";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: orgs = [], loading: orgsLoading, refetch: refetchOrgs } = useOrgs();
  const [activeOrgId, setActiveOrgIdState] = useState<string | undefined>(
    () => localStorage.getItem(ORG_KEY) ?? undefined,
  );

  const {
    data: projects = [],
    loading: projectsLoading,
    refetch: refetchProjects,
  } = useProjects(activeOrgId);

  const [activeProjectId, setActiveProjectIdState] = useState<string | undefined>(
    () => localStorage.getItem(PROJECT_KEY) ?? undefined,
  );

  // Default the active org to the first one once loaded.
  useEffect(() => {
    if (!activeOrgId && orgs.length > 0) {
      setActiveOrgIdState(orgs[0].id);
    }
    // If the persisted org no longer exists, fall back to first.
    if (activeOrgId && orgs.length > 0 && !orgs.some((o) => o.id === activeOrgId)) {
      setActiveOrgIdState(orgs[0].id);
    }
  }, [orgs, activeOrgId]);

  // Default the active project to the first one in the active org.
  useEffect(() => {
    if (projects.length === 0) return;
    if (!activeProjectId || !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectIdState(projects[0].id);
    }
  }, [projects, activeProjectId]);

  const setActiveOrgId = (id: string) => {
    setActiveOrgIdState(id);
    localStorage.setItem(ORG_KEY, id);
    // Reset project — it will re-default via the effect above.
    setActiveProjectIdState(undefined);
    localStorage.removeItem(PROJECT_KEY);
  };

  const setActiveProjectId = (id: string) => {
    setActiveProjectIdState(id);
    localStorage.setItem(PROJECT_KEY, id);
  };

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      orgs,
      projects,
      activeOrg: orgs.find((o) => o.id === activeOrgId),
      activeProject: projects.find((p) => p.id === activeProjectId),
      activeOrgId,
      activeProjectId,
      setActiveOrgId,
      setActiveProjectId,
      loading: orgsLoading || projectsLoading,
      refetchOrgs,
      refetchProjects,
    }),
    [orgs, projects, activeOrgId, activeProjectId, orgsLoading, projectsLoading, refetchOrgs, refetchProjects],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within <WorkspaceProvider>");
  return ctx;
}
