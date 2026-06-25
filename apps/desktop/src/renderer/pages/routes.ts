import { lazy, type LazyExoticComponent, type ComponentType } from "react";

// ── Lazy-loaded pages ────────────────────────────────────────────────────────

const pages = {
  login: lazy(() => import("./login")),
  onboarding: lazy(() => import("./onboarding")),
  dashboard: lazy(() => import("./dashboard")),
  chat: lazy(() => import("./chat")),
  chatNew: lazy(() => import("./chat-new")),
  artifacts: lazy(() => import("./artifacts")),
  artifactDetail: lazy(() => import("./artifact-detail")),
  memory: lazy(() => import("./memory")),
  graph: lazy(() => import("./graph")),
  branchCompare: lazy(() => import("./branch-compare")),
  settings: lazy(() => import("./settings")),
  settingsModels: lazy(() => import("./settings-models")),
  settingsCosts: lazy(() => import("./settings-costs")),
  orgs: lazy(() => import("./orgs")),
  projects: lazy(() => import("./projects")),
  mcpServers: lazy(() => import("./mcp-servers")),
  skills: lazy(() => import("./skills")),
  permissions: lazy(() => import("./permissions")),
  knowledgeBase: lazy(() => import("./knowledge-base")),
  personas: lazy(() => import("./personas")),
} satisfies Record<string, LazyExoticComponent<ComponentType>>;

export interface RouteDef {
  path: string;
  Component: LazyExoticComponent<ComponentType>;
  /** Route index=true (matches parent path exactly) */
  index?: boolean;
}

/** Routes rendered inside AuthLayout (guest-only, minimal shell) */
export const authRoutes: RouteDef[] = [
  { path: "/login", Component: pages.login },
  { path: "/onboarding", Component: pages.onboarding },
];

/** Routes rendered inside AppLayout (auth-protected, full shell) */
export const appRoutes: RouteDef[] = [
  { path: "/", index: true, Component: pages.dashboard },
  { path: "/chat/new", Component: pages.chatNew },
  { path: "/chat/:branchId", Component: pages.chat },
  { path: "/artifacts", Component: pages.artifacts },
  { path: "/artifacts/:id", Component: pages.artifactDetail },
  { path: "/memory", Component: pages.memory },
  { path: "/knowledge-base", Component: pages.knowledgeBase },
  { path: "/graph", Component: pages.graph },
  { path: "/branches/compare", Component: pages.branchCompare },
  { path: "/settings", Component: pages.settings },
  { path: "/settings/models", Component: pages.settingsModels },
  { path: "/settings/costs", Component: pages.settingsCosts },
  { path: "/settings/mcp-servers", Component: pages.mcpServers },
  { path: "/settings/skills", Component: pages.skills },
  { path: "/settings/permissions", Component: pages.permissions },
  { path: "/settings/personas", Component: pages.personas },
  { path: "/orgs", Component: pages.orgs },
  { path: "/projects", Component: pages.projects },
];
