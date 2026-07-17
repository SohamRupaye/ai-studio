import { NavLink } from "react-router-dom";
import {
  BuildingsIcon,
  ClockCountdownIcon,
  FolderSimpleIcon,
  LightningIcon,
  PlugsConnectedIcon,
  PlugsIcon,
  GearIcon
} from "@phosphor-icons/react";
import type { Organisation, Project } from "@squirl/shared";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Nav — the whole cascade, not just the active path through it.
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsNav({
  orgs,
  projects,
  currentOrgId,
}: {
  orgs: Organisation[];
  projects: Project[];
  currentOrgId: string | undefined;
}) {
  return (
    <nav className="w-56 shrink-0 overflow-y-auto border-r border-line px-4 py-9">
      <h1 className="px-2 text-heading-sm text-fg">Settings</h1>

      <div className="mt-7 space-y-6">
        <SettingsNavGroup label="General">
          <SettingsNavLink to="/settings/general">
            <GearIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">General</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/providers">
            <PlugsConnectedIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Providers</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/mcp">
            <PlugsIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">MCP servers</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/skills">
            <LightningIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Skills</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/automations">
            <ClockCountdownIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Automations</span>
          </SettingsNavLink>
        </SettingsNavGroup>

        <SettingsNavGroup label="Organizations">
          {orgs.map((org) => (
            <SettingsNavLink
              key={org.id}
              to={`/settings/organization/${org.id}`}
              // Keep the org that owns the listed projects readable even when
              // a project page (not the org page) is the active route.
              emphasized={org.id === currentOrgId}
            >
              <BuildingsIcon size={16} className="shrink-0 text-fg-subtle" />
              <span className="truncate">{org.name}</span>
            </SettingsNavLink>
          ))}
        </SettingsNavGroup>

        <SettingsNavGroup label="Projects">
          {projects.length === 0 && (
            <p className="px-2 py-1 text-body-sm text-fg-subtle">
              No projects yet
            </p>
          )}
          {projects.map((p) => (
            <SettingsNavLink key={p.id} to={`/settings/project/${p.id}`}>
              {p.icon ? (
                <img
                  src={p.icon}
                  alt=""
                  className="size-4 shrink-0 rounded-[4px] object-cover"
                />
              ) : (
                <FolderSimpleIcon
                  size={16}
                  className="shrink-0 text-fg-subtle"
                />
              )}
              <span className="truncate">{p.name}</span>
            </SettingsNavLink>
          ))}
        </SettingsNavGroup>
      </div>
    </nav>
  );
}

function SettingsNavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2 pb-1 text-label-sm text-fg-subtle">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SettingsNavLink({
  to,
  emphasized,
  children,
}: {
  to: string;
  emphasized?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "pressable flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-label-md",
          isActive
            ? "bg-surface-2 text-fg shadow-raised"
            : cn("text-fg-muted hover:bg-surface-1 hover:text-fg", emphasized && "text-fg"),
        )
      }
    >
      {children}
    </NavLink>
  );
}
