import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsLeftRightIcon,
  BrainIcon,
  BuildingsIcon,
  CaretRightIcon,
  CubeIcon,
  DotsThreeIcon,
  FolderSimpleIcon,
  PaintBrushIcon,
  PlugsConnectedIcon,
  PlugsIcon,
  PlusIcon,
  SignOutIcon,
  TerminalWindowIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { Organisation, Project } from "@ai-studio/shared";
import type { MCPServerEntry, MCPTransport } from "@ai-studio/event-bus";
import { cn, counted } from "../lib/utils";
import { useTheme } from "../hooks/use-theme";
import { useWorkspace } from "./workspace-provider";
import {
  useCodexStatus,
  useConfig,
  useMCPServers,
  useModels,
  useMutation,
  useOrgs,
  useProjects,
  useQuery,
} from "../hooks/use-ipc-data";
import { ConfirmDialog } from "./confirm-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProviderTile } from "./provider-logos";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupItem } from "./ui/button-group";
import { Combobox } from "./ui/combobox";
import { Input, Textarea } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

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
            : "general";
  const navOrgId = orgId ?? project?.orgId ?? activeOrgId;
  const { data: projects = [] } = useProjects(navOrgId);

  return (
    <div className="flex h-full">
      <SettingsNav orgs={orgs} projects={projects} currentOrgId={navOrgId} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-10 py-10">
          {scope === "general" && <GeneralSettings />}
          {scope === "providers" && <ProvidersSettings />}
          {scope === "provider-models" && <ProviderModelsPage key={provider} provider={provider!} />}
          {scope === "mcp" && <MCPSettings />}
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

// ─────────────────────────────────────────────────────────────────────────────
// Nav — the whole cascade, not just the active path through it.
// ─────────────────────────────────────────────────────────────────────────────

function SettingsNav({
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
            <PaintBrushIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Appearance</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/providers">
            <PlugsConnectedIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Providers</span>
          </SettingsNavLink>
          <SettingsNavLink to="/settings/mcp">
            <PlugsIcon size={16} className="shrink-0 text-fg-subtle" />
            <span className="truncate">MCP servers</span>
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
            <p className="px-2 py-1 text-body-sm text-fg-subtle">No projects yet</p>
          )}
          {projects.map((p) => (
            <SettingsNavLink key={p.id} to={`/settings/project/${p.id}`}>
              {p.icon ? (
                <img src={p.icon} alt="" className="size-4 shrink-0 rounded-[4px] object-cover" />
              ) : (
                <FolderSimpleIcon size={16} className="shrink-0 text-fg-subtle" />
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared page primitives
// ─────────────────────────────────────────────────────────────────────────────

function ScopeHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <header>
      <h2 className="text-heading-md text-fg">{title}</h2>
      <p className="mt-1 text-body-md text-fg-muted">{hint}</p>
    </header>
  );
}

/** Label + hint on the left, the control on the right — settings grammar. */
function FieldRow({
  label,
  hint,
  htmlFor,
  align = "center",
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  /** "start" for tall controls like textareas. */
  align?: "center" | "start";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-10 py-4",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-label-md text-fg">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-body-sm text-fg-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h3 className="text-label-lg text-fg">{title}</h3>
      {hint && <p className="mt-0.5 text-body-sm text-fg-muted">{hint}</p>}
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// General — app-wide preferences
// ─────────────────────────────────────────────────────────────────────────────

function GeneralSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <ScopeHeader title="General" hint="Preferences that apply everywhere, on this device." />

      <SettingsSection title="Appearance">
        <div className="mt-2 divide-y divide-line">
          <FieldRow label="Theme" hint="System follows your OS setting.">
            <ButtonGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
              <ButtonGroupItem value="system">System</ButtonGroupItem>
              <ButtonGroupItem value="light">Light</ButtonGroupItem>
              <ButtonGroupItem value="dark">Dark</ButtonGroupItem>
            </ButtonGroup>
          </FieldRow>
        </div>
      </SettingsSection>

      <p className="mt-9 text-body-sm text-fg-subtle">
        Provider accounts, API keys and models live under Providers; external tools under MCP
        servers.
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers — the account's provider connections and global API keys.
// ─────────────────────────────────────────────────────────────────────────────

// Unset providers most people reach for stay visible; the long tail hides
// behind "Show all" so the page reads as your setup, not a catalogue.
const POPULAR_PROVIDERS = new Set(["anthropic", "openai", "google", "openrouter"]);

/** models:list / disabled_models are keyed by router entry name. */
const routerEntryName = (provider: string) => (provider === "codex" ? "codex_oauth" : provider);

function ProvidersSettings() {
  const navigate = useNavigate();
  const { data: keys } = useQuery("config:keys", undefined);
  const { data: codex } = useCodexStatus();
  const { data: config } = useConfig();
  const { data: models } = useModels();
  const setConfig = useMutation("config:set");
  const codexLogin = useMutation("codex:login");
  const codexLogout = useMutation("codex:logout");
  const codexSwitch = useMutation("codex:switch-account");
  const [showAll, setShowAll] = useState(false);

  const codexAction = async (action: () => Promise<unknown>, failMessage: string) => {
    try {
      await action();
    } catch {
      toast.error(failMessage);
    }
  };

  const modelCount = (provider: string) => (models?.[routerEntryName(provider)] ?? []).length;
  const totalModels = Object.values(models ?? {}).reduce((n, list) => n + list.length, 0);

  const entries = Object.entries(keys ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const activeCount = entries.filter(([, isSet]) => isSet).length;
  const visibleEntries = showAll
    ? entries
    : entries.filter(([provider, isSet]) => isSet || POPULAR_PROVIDERS.has(provider));
  const hiddenCount = entries.length - visibleEntries.length;

  const modelItems = [...new Set(Object.values(models ?? {}).flat())].map((id) => ({
    value: id,
    label: id,
  }));
  const defaultModel = (config?.defaultModel as string | undefined) ?? null;

  return (
    <>
      <ScopeHeader
        title="Providers"
        hint={
          totalModels
            ? `Provider accounts and API keys — ${counted(totalModels, "model")} available across your setup.`
            : "Provider accounts and API keys — used everywhere unless an organization overrides them."
        }
      />

      <SettingsSection title="Accounts" hint="Provider subscriptions connected by signing in.">
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <ProviderRow
            provider="codex"
            monogram="C"
            active={Boolean(codex?.connected)}
            name="Codex"
            badge="Connected"
            onOpen={codex?.connected ? () => navigate("/settings/providers/codex") : undefined}
            hint={
              codex?.connected
                ? `Signed in${codex.email ? ` as ${codex.email}` : ""} — ${
                    modelCount("codex")
                      ? `${counted(modelCount("codex"), "model")} via your Codex subscription.`
                      : "OpenAI models via your Codex subscription."
                  }`
                : "Sign in with your OpenAI account — no API key needed."
            }
          >
            {codex?.connected ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    codexAction(() => codexSwitch.mutate(undefined), "Couldn't switch accounts")
                  }
                >
                  Switch account
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    codexAction(() => codexLogout.mutate(undefined), "Couldn't sign out")
                  }
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={codexLogin.loading}
                onClick={() =>
                  codexAction(() => codexLogin.mutate(undefined), "Couldn't connect Codex")
                }
              >
                {codexLogin.loading ? "Connecting…" : "Connect"}
              </Button>
            )}
          </ProviderRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Defaults"
        hint="What new chats start with — every branch can still pick its own model."
      >
        <div className="mt-2 divide-y divide-line">
          <FieldRow
            label="Default model"
            hint="Used whenever a branch doesn't pin one."
          >
            <Combobox
              className="w-72 font-mono"
              items={modelItems}
              value={defaultModel}
              placeholder={modelItems.length ? "Choose a model" : "No models available yet"}
              onValueChange={async (value) => {
                if (!value || value === defaultModel) return;
                try {
                  await setConfig.mutate({ defaultModel: value });
                } catch {
                  toast.error("Couldn't set default model");
                }
              }}
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="API keys"
        hint={`${activeCount} of ${entries.length} configured — stored locally in config.yaml; organizations can override any of them.`}
      >
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {/* Providers with keys float to the top — yours first, the catalogue after. */}
          {visibleEntries.map(([provider, isSet]) => (
            <ProviderKeyRow
              key={provider}
              provider={provider}
              isSet={isSet}
              setHint={
                modelCount(provider)
                  ? `${counted(modelCount(provider), "model")} available via this key.`
                  : "Used everywhere unless an organization overrides it."
              }
              onOpen={
                isSet ? () => navigate(`/settings/providers/${provider}`) : undefined
              }
              onSave={async (value) => {
                await setConfig.mutate({ apiKeys: { [provider]: value } });
              }}
              onClear={async () => {
                await setConfig.mutate({ apiKeys: { [provider]: null } });
              }}
            />
          ))}
          {(hiddenCount > 0 || showAll) && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="pressable flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-label-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <CaretRightIcon
                size={12}
                weight="bold"
                className={cn("transition-transform duration-200 ease-(--ease-standard)", showAll && "rotate-90")}
              />
              {showAll ? "Show fewer providers" : `Show ${hiddenCount} more providers`}
            </button>
          )}
        </div>
      </SettingsSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP servers — external tools plugged into every chat. Quick-connect
// presets for the official remote servers, plus a custom-server dialog.
// Backend handles persistence (config.yaml) and reconnect-on-launch.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_HINT =
  "Create an OAuth client at console.cloud.google.com (APIs & Services → Credentials → OAuth client ID, type “Desktop app”) and enable the product's MCP API for the project. The same client works for Gmail, Calendar and Drive.";

const MCP_PRESETS: Array<{
  name: string;
  label: string;
  hint: string;
  type: MCPTransport;
  url: string;
  /** "oauth-client" = the server's IdP has no dynamic registration; Connect
   * opens the paste-your-OAuth-client dialog instead of attempting sign-in. */
  auth?: "oauth-client";
  /** Where to create that OAuth client (shown in the dialog). */
  clientHint?: string;
}> = [
  { name: "notion", label: "Notion", hint: "Pages, databases and wikis.", type: "http", url: "https://mcp.notion.com/mcp" },
  { name: "github", label: "GitHub", hint: "Repos, issues and pull requests.", type: "http", url: "https://api.githubcopilot.com/mcp/" },
  { name: "figma", label: "Figma", hint: "Design files and components.", type: "http", url: "https://mcp.figma.com/mcp" },
  { name: "canva", label: "Canva", hint: "Design creation and editing.", type: "http", url: "https://mcp.canva.com/mcp" },
  { name: "slack", label: "Slack", hint: "Messages, channels and canvases.", type: "http", url: "https://mcp.slack.com/mcp" },
  { name: "linear", label: "Linear", hint: "Issues, projects and cycles.", type: "http", url: "https://mcp.linear.app/mcp" },
  { name: "atlassian", label: "Atlassian", hint: "Jira issues and Confluence pages.", type: "http", url: "https://mcp.atlassian.com/v1/mcp" },
  { name: "asana", label: "Asana", hint: "Tasks, projects and goals.", type: "http", url: "https://mcp.asana.com/mcp" },
  { name: "sentry", label: "Sentry", hint: "Errors, issues and performance.", type: "http", url: "https://mcp.sentry.dev/mcp" },
  { name: "vercel", label: "Vercel", hint: "Deployments, projects and logs.", type: "http", url: "https://mcp.vercel.com/" },
  { name: "stripe", label: "Stripe", hint: "Payments, customers and invoices.", type: "http", url: "https://mcp.stripe.com/" },
  // Google Workspace: official servers, but accounts.google.com has no
  // dynamic registration — each install needs its own Google Cloud OAuth
  // client until AI Studio ships a verified one (tracked in context/debt.md).
  { name: "gmail", label: "Gmail", hint: "Search, read and draft email.", type: "http", url: "https://gmailmcp.googleapis.com/mcp/v1", auth: "oauth-client", clientHint: GOOGLE_CLIENT_HINT },
  { name: "calendar", label: "Google Calendar", hint: "Events and scheduling.", type: "http", url: "https://calendarmcp.googleapis.com/mcp/v1", auth: "oauth-client", clientHint: GOOGLE_CLIENT_HINT },
  { name: "drive", label: "Google Drive", hint: "Files, folders and sharing.", type: "http", url: "https://drivemcp.googleapis.com/mcp/v1", auth: "oauth-client", clientHint: GOOGLE_CLIENT_HINT },
];

const MCP_STATUS_BADGE: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  connected: { label: "Connected", variant: "success" },
  needs_auth: { label: "Needs auth", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
  reconnecting: { label: "Reconnecting…", variant: "info" },
  disabled: { label: "Disabled", variant: "neutral" },
};

function MCPSettings() {
  const { data: servers = [] } = useMCPServers();
  const addServer = useMutation("mcp:add");
  const authenticate = useMutation("mcp:authenticate");
  const [addingCustom, setAddingCustom] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [clientDialog, setClientDialog] = useState<{ name: string; label: string; hint?: string } | null>(null);

  const existingNames = new Set(servers.map((s) => s.config.name.toLowerCase()));
  const presets = MCP_PRESETS.filter((p) => !existingNames.has(p.name));

  const connectPreset = async (preset: (typeof MCP_PRESETS)[number]) => {
    setConnecting(preset.name);
    try {
      let entry = await addServer.mutate({ name: preset.name, type: preset.type, url: preset.url });
      if (entry.status.status === "needs_auth" && preset.auth === "oauth-client") {
        // No dynamic registration at this server's IdP (Google) — collect the
        // user's own OAuth client first; the dialog then runs the sign-in.
        setClientDialog({ name: preset.name, label: preset.label, hint: preset.clientHint });
        return;
      }
      if (entry.status.status === "needs_auth") {
        // "Most sign you in on first use" — run the OAuth flow right away
        // instead of parking the server on a Needs-auth badge.
        toast(`Finish signing in to ${preset.label} in your browser…`);
        entry = await authenticate.mutate({ name: preset.name });
      }
      if (entry.status.status === "connected") {
        toast.success(`Connected to ${preset.label} — ${counted(entry.tools.length, "tool")} available`);
      } else if (entry.status.status === "failed") {
        toast.error(`${preset.label}: ${entry.status.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't connect to ${preset.label}`);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <>
      <ScopeHeader
        title="MCP servers"
        hint="Model Context Protocol — plug external tools into every chat in the app."
      />

      {servers.length > 0 && (
        <SettingsSection title="Your servers">
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {servers.map((server) => {
              const preset = MCP_PRESETS.find((p) => p.name === server.config.name.toLowerCase());
              return (
                <MCPServerRow
                  key={server.config.name}
                  server={server}
                  onOauthClient={() =>
                    setClientDialog({
                      name: server.config.name,
                      label: preset?.label ?? server.config.name,
                      hint: preset?.clientHint,
                    })
                  }
                />
              );
            })}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Quick connect"
        hint="Official remote servers — most sign you in on first use."
      >
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {presets.length === 0 && (
            <p className="px-4 py-3.5 text-body-sm text-fg-subtle">
              Everything here is already connected.
            </p>
          )}
          {presets.map((preset) => (
            <ProviderRow
              key={preset.name}
              provider={preset.name}
              monogram={preset.label.slice(0, 1).toUpperCase()}
              active={false}
              name={preset.label}
              hint={preset.hint}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={connecting === preset.name}
                onClick={() => connectPreset(preset)}
              >
                {connecting === preset.name ? "Connecting…" : "Connect"}
              </Button>
            </ProviderRow>
          ))}
          <button
            type="button"
            onClick={() => setAddingCustom(true)}
            className="pressable flex w-full items-center justify-center gap-1.5 px-4 py-3 text-label-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <PlusIcon size={14} />
            Add custom server
          </button>
        </div>
      </SettingsSection>

      <AddMCPServerDialog open={addingCustom} onOpenChange={setAddingCustom} />
      <OAuthClientDialog target={clientDialog} onClose={() => setClientDialog(null)} />
    </>
  );
}

/**
 * Collects a pre-registered OAuth client (id + optional secret) for a server
 * whose identity provider has no dynamic registration (Google Workspace…),
 * then immediately runs the browser sign-in with it.
 */
function OAuthClientDialog({
  target,
  onClose,
}: {
  target: { name: string; label: string; hint?: string } | null;
  onClose: () => void;
}) {
  const setOauthClient = useMutation("mcp:set-oauth-client");
  const authenticate = useMutation("mcp:authenticate");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setClientId("");
      setClientSecret("");
    }
  }, [target]);

  const submit = async () => {
    if (!target || !clientId.trim() || busy) return;
    setBusy(true);
    try {
      await setOauthClient.mutate({
        name: target.name,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      onClose();
      toast(`Finish signing in to ${target.label} in your browser…`);
      const entry = await authenticate.mutate({ name: target.name });
      if (entry.status.status === "connected") {
        toast.success(`Connected to ${target.label} — ${counted(entry.tools.length, "tool")} available`);
      } else if (entry.status.status === "failed") {
        toast.error(`${target.label}: ${entry.status.error}`);
      } else if (entry.status.status === "needs_auth") {
        toast.error(`${target.label} didn't accept the sign-in — check the client id and its redirect URI.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't sign in to ${target.label}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {target?.label} with an OAuth client</DialogTitle>
          <DialogDescription>
            {target?.hint ??
              "This service doesn't let apps sign in automatically — paste an OAuth client you registered with it. Register the redirect URI http://127.0.0.1:19876/callback."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-4 px-5">
            <div className="space-y-1.5">
              <label htmlFor="oauth-client-id" className="text-label-md text-fg">
                Client ID
              </label>
              <Input
                id="oauth-client-id"
                autoFocus
                autoComplete="off"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. 1234….apps.googleusercontent.com"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="oauth-client-secret" className="text-label-md text-fg">
                Client secret <span className="text-fg-subtle">(if your client has one)</span>
              </label>
              <Input
                id="oauth-client-secret"
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!clientId.trim() || busy}>
              {busy ? "Waiting for browser…" : "Save and sign in"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MCPServerRow({
  server,
  onOauthClient,
}: {
  server: MCPServerEntry;
  onOauthClient: () => void;
}) {
  const removeServer = useMutation("mcp:remove");
  const reconnectServer = useMutation("mcp:reconnect");
  const authenticate = useMutation("mcp:authenticate");
  const setToken = useMutation("mcp:set-token");
  const [tokenEditing, setTokenEditing] = useState(false);
  const [tokenValue, setTokenValue] = useState("");
  const tokenCancelled = useRef(false);
  const { config, status, tools } = server;
  const badge = MCP_STATUS_BADGE[status.status] ?? MCP_STATUS_BADGE["disabled"]!;
  const connected = status.status === "connected";
  const target = config.url ?? [config.command, ...(config.args ?? [])].join(" ");
  const preset = MCP_PRESETS.find((p) => p.name === config.name.toLowerCase());
  const label = preset?.label ?? config.name;

  const act = async (action: () => Promise<unknown>, failMessage: string) => {
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failMessage);
    }
  };

  const runAuth = () =>
    act(async () => {
      toast(`Finish signing in to ${label} in your browser…`);
      const entry = await authenticate.mutate({ name: config.name });
      if (entry.status.status === "connected") {
        toast.success(`Connected to ${label} — ${counted(entry.tools.length, "tool")} available`);
      } else if (entry.status.status === "failed") {
        toast.error(`${label}: ${entry.status.error}`);
      }
    }, `Couldn't sign in to ${label}`);

  const runReconnect = () =>
    act(async () => {
      const entry = await reconnectServer.mutate({ name: config.name });
      if (entry.status.status === "connected") {
        toast.success(`Reconnected ${label} — ${counted(entry.tools.length, "tool")} available`);
      } else if (entry.status.status === "needs_auth") {
        toast(`${label} still needs authentication — use Authenticate.`);
      } else if (entry.status.status === "failed") {
        toast.error(`${label}: ${entry.status.error}`);
      }
    }, `Couldn't reconnect ${label}`);

  const saveToken = async () => {
    if (tokenCancelled.current) {
      tokenCancelled.current = false;
      return;
    }
    const trimmed = tokenValue.trim();
    setTokenEditing(false);
    setTokenValue("");
    if (!trimmed) return;
    await act(async () => {
      const entry = await setToken.mutate({ name: config.name, token: trimmed });
      if (entry.status.status === "connected") {
        toast.success(`Connected to ${label} — ${counted(entry.tools.length, "tool")} available`);
      } else if (entry.status.status === "needs_auth") {
        toast.error(`${label} rejected that token — check its scopes and expiry.`);
      } else if (entry.status.status === "failed") {
        toast.error(`${label}: ${entry.status.error}`);
      }
    }, `Couldn't connect ${label} with that token`);
  };

  return (
    <div className="group/row flex min-h-14 items-center gap-3.5 px-4 py-2.5">
      <ProviderTile
        provider={config.name.toLowerCase()}
        monogram={label.slice(0, 1).toUpperCase()}
        active={connected}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-label-md", connected ? "text-fg" : "text-fg-muted")}>
            {label}
          </span>
          <Badge variant={badge.variant} className="px-2 py-0.5 text-label-sm">
            {badge.label}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
          {status.status === "failed"
            ? status.error
            : connected
              ? `${counted(tools.length, "tool")} · ${target}`
              : target}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {tokenEditing ? (
          <Input
            autoFocus
            type="password"
            autoComplete="off"
            className="w-64"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            onBlur={saveToken}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                tokenCancelled.current = true;
                setTokenEditing(false);
                setTokenValue("");
              }
            }}
            placeholder={`${label} access token`}
          />
        ) : (
          <>
            {status.status === "needs_auth" && (
              <Button variant="secondary" size="sm" disabled={authenticate.loading} onClick={runAuth}>
                {authenticate.loading ? "Waiting for browser…" : "Authenticate"}
              </Button>
            )}
            {Boolean(config.url) && !connected && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    tokenCancelled.current = false;
                    setTokenValue("");
                    setTokenEditing(true);
                  }}
                >
                  Use token
                </Button>
                <Button variant="ghost" size="sm" onClick={onOauthClient}>
                  {config.hasOauthClient ? "Replace client" : "OAuth client"}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" disabled={reconnectServer.loading} onClick={runReconnect}>
              {reconnectServer.loading ? "Reconnecting…" : "Reconnect"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                act(() => removeServer.mutate({ name: config.name }), `Couldn't remove ${label}`)
              }
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function AddMCPServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addServer = useMutation("mcp:add");
  const authenticate = useMutation("mcp:authenticate");
  const [name, setName] = useState("");
  const [type, setType] = useState<MCPTransport>("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setType("http");
      setUrl("");
      setCommand("");
    }
  }, [open]);

  const valid = name.trim() && (type === "stdio" ? command.trim() : url.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const parts = command.trim().split(/\s+/);
      const config =
        type === "stdio"
          ? { name: name.trim(), type, command: parts[0]!, args: parts.slice(1) }
          : { name: name.trim(), type, url: url.trim() };
      let entry = await addServer.mutate(config);
      if (entry.status.status === "needs_auth") {
        // Close the dialog first — the rest of the flow lives in the browser.
        onOpenChange(false);
        toast(`Finish signing in to ${name} in your browser…`);
        entry = await authenticate.mutate({ name: name.trim() });
      }
      if (entry.status.status === "failed") {
        toast.error(`${name}: ${entry.status.error}`);
      } else if (entry.status.status === "connected") {
        toast.success(`Connected to ${name} — ${counted(entry.tools.length, "tool")} available`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Connect any Model Context Protocol server — remote (HTTP/SSE) or a local command.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-4 px-5">
            <div className="space-y-1.5">
              <label htmlFor="mcp-name" className="text-label-md text-fg">
                Name
              </label>
              <Input
                id="mcp-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-server"
              />
            </div>
            <div className="space-y-1.5">
              <span className="block text-label-md text-fg">Transport</span>
              <ButtonGroup value={type} onValueChange={(v) => setType(v as MCPTransport)}>
                <ButtonGroupItem value="http">HTTP</ButtonGroupItem>
                <ButtonGroupItem value="sse">SSE</ButtonGroupItem>
                <ButtonGroupItem value="stdio">Command</ButtonGroupItem>
              </ButtonGroup>
            </div>
            {type === "stdio" ? (
              <div className="space-y-1.5">
                <label htmlFor="mcp-command" className="text-label-md text-fg">
                  Command
                </label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                  className="font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="mcp-url" className="text-label-md text-fg">
                  URL
                </label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="font-mono"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-provider model management — every model the provider exposes, with a
// checkbox for whether it appears in selection menus. A filter, not routing:
// branches already pinned to a hidden model keep working.
// ─────────────────────────────────────────────────────────────────────────────

function ProviderModelsPage({ provider }: { provider: string }) {
  const navigate = useNavigate();
  const { label } = providerMeta(provider);
  const name = provider === "codex" ? "Codex" : label;
  const entry = routerEntryName(provider);
  const { data: catalogue } = useQuery("models:all", undefined);
  const { data: config } = useConfig();
  const setConfig = useMutation("config:set");
  const [query, setQuery] = useState("");

  const models = catalogue?.[entry] ?? [];
  const disabled = new Set(
    ((config?.disabledModels as Record<string, string[]> | undefined)?.[entry] ?? []).filter(
      (m) => models.includes(m), // ignore stale entries for models that no longer exist
    ),
  );
  const enabledCount = models.length - disabled.size;
  const visible = query
    ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
    : models;

  const saveDisabled = async (next: Set<string>) => {
    try {
      await setConfig.mutate({ disabledModels: { [entry]: [...next] } });
    } catch {
      toast.error("Couldn't update models");
    }
  };

  const toggle = (model: string) => {
    const next = new Set(disabled);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    saveDisabled(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => navigate("/settings/providers")}
        className="pressable -ml-2 mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 text-label-md text-fg-muted hover:bg-surface-1 hover:text-fg"
      >
        <ArrowLeftIcon size={14} />
        Providers
      </button>

      <div className="flex items-center gap-4">
        <ProviderTile
          provider={provider}
          monogram={name.slice(0, 1).toUpperCase()}
          active
          className="size-11 rounded-lg text-heading-sm"
          iconClassName="[&>svg]:size-5"
        />
        <div className="min-w-0">
          <h2 className="text-heading-md text-fg">{name}</h2>
          <p className="mt-0.5 text-body-md text-fg-muted">
            {enabledCount} of {counted(models.length, "model")} shown in selection menus.
          </p>
        </div>
      </div>

      <SettingsSection title="Models" hint="Unchecked models stay usable on branches that already pin them — they just stop appearing in menus.">
        <div className="mt-4 flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${models.length} models`}
            className="max-w-64"
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled.size === 0}
              onClick={() => saveDisabled(new Set())}
            >
              Enable all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled.size === models.length}
              onClick={() => saveDisabled(new Set(models))}
            >
              Disable all
            </Button>
          </div>
        </div>

        <div className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {visible.length === 0 && (
            <p className="px-4 py-3.5 text-body-sm text-fg-subtle">
              {models.length === 0 ? "No models reported by this provider yet." : "No models match."}
            </p>
          )}
          {visible.map((model) => {
            const enabled = !disabled.has(model);
            return (
              <label
                key={model}
                className="flex cursor-default select-none items-center gap-3.5 px-4 py-2.5 hover:bg-surface-2"
              >
                <Checkbox checked={enabled} onCheckedChange={() => toggle(model)} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-body-sm",
                    enabled ? "text-fg" : "text-fg-subtle",
                  )}
                >
                  {model}
                </span>
              </label>
            );
          })}
        </div>
      </SettingsSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization — overrides shared across the org's projects (placeholder)
// ─────────────────────────────────────────────────────────────────────────────

// Display names + key consoles for the providers the router supports. Rows
// are driven by the keys queries (main enumerates API_KEY_PROVIDERS), so a
// new provider still shows up here even before it gets an entry.
const PROVIDER_META: Record<string, { label: string; site: string }> = {
  anthropic: { label: "Anthropic", site: "console.anthropic.com" },
  openai: { label: "OpenAI", site: "platform.openai.com" },
  google: { label: "Google", site: "aistudio.google.com" },
  openrouter: { label: "OpenRouter", site: "openrouter.ai" },
  groq: { label: "Groq", site: "console.groq.com" },
  mistral: { label: "Mistral", site: "console.mistral.ai" },
  deepseek: { label: "DeepSeek", site: "platform.deepseek.com" },
  xai: { label: "xAI", site: "console.x.ai" },
  together: { label: "Together AI", site: "api.together.ai" },
  fireworks: { label: "Fireworks", site: "fireworks.ai" },
  cerebras: { label: "Cerebras", site: "cloud.cerebras.ai" },
  perplexity: { label: "Perplexity", site: "perplexity.ai" },
  cohere: { label: "Cohere", site: "dashboard.cohere.com" },
  nvidia: { label: "NVIDIA", site: "build.nvidia.com" },
  deepinfra: { label: "DeepInfra", site: "deepinfra.com" },
  alibaba: { label: "Alibaba", site: "dashscope.console.aliyun.com" },
};

const providerMeta = (provider: string) =>
  PROVIDER_META[provider] ?? { label: provider, site: "" };

function OrganizationSettings({
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

// Shared anatomy for provider-shaped rows (key rows, the Codex account row):
// neutral tile holding the provider's monochrome mark in currentColor (raised
// and brightened when active — elevation and tone mean state, never a colored
// chip), name + status badge, hint line, actions at the trailing edge.
function ProviderRow({
  provider,
  monogram,
  active,
  name,
  badge,
  hint,
  onOpen,
  children,
}: {
  /** Keys into the logo set; rows without a mark fall back to the monogram. */
  provider?: string;
  monogram: string;
  active: boolean;
  name: string;
  /** Status badge next to the name while active. */
  badge?: string;
  hint: React.ReactNode;
  /** When set, the identity area click-navigates (e.g. to model management). */
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const identity = (
    <>
      <ProviderTile provider={provider} monogram={monogram} active={active} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-label-md", active ? "text-fg" : "text-fg-muted")}>
            {name}
          </span>
          {active && badge && (
            <Badge variant="success" className="px-2 py-0.5 text-label-sm">
              {badge}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">{hint}</span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "group/row flex min-h-14 items-center gap-3.5 px-4 py-2.5",
        onOpen && "hover:bg-surface-2",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
        >
          {identity}
        </button>
      ) : (
        identity
      )}
      <div className="flex shrink-0 items-center gap-1">{children}</div>
      {onOpen && <CaretRightIcon size={14} className="shrink-0 text-fg-subtle" />}
    </div>
  );
}

// One provider's API key at some scope. Keys never round-trip to the
// renderer — the status query only says whether one is set. The input only
// exists while adding/replacing (Enter saves, Esc cancels), so the list
// reads as state, not as a wall of empty fields.
function ProviderKeyRow({
  provider,
  isSet,
  setHint,
  unsetHint,
  addLabel = "Add key",
  badge = "Active",
  onOpen,
  onSave,
  onClear,
}: {
  provider: string;
  isSet: boolean;
  /** Hint while a key is set — what the key does at this scope. */
  setHint: React.ReactNode;
  /** Hint while unset; defaults to a link to the provider's key console. */
  unsetHint?: React.ReactNode;
  addLabel?: string;
  badge?: string;
  /** Click-through on the identity area (e.g. model management). */
  onOpen?: () => void;
  onSave: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const { label, site } = providerMeta(provider);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const cancelled = useRef(false);

  const open = () => {
    cancelled.current = false;
    setValue("");
    setEditing(true);
  };

  const submit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const trimmed = value.trim();
    setEditing(false);
    setValue("");
    if (!trimmed) return;
    try {
      await onSave(trimmed);
    } catch {
      toast.error(`Couldn't save ${label} key`);
    }
  };

  const clear = async () => {
    try {
      await onClear();
    } catch {
      toast.error(`Couldn't clear ${label} key`);
    }
  };

  return (
    <ProviderRow
      provider={provider}
      monogram={label.slice(0, 1).toUpperCase()}
      active={isSet}
      name={label}
      badge={badge}
      onOpen={onOpen}
      hint={
        isSet
          ? setHint
          : (unsetHint ??
            (site ? (
              // The window-open handler routes _blank to the system browser.
              <a
                href={`https://${site}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:text-fg-muted hover:underline"
              >
                Get a key at {site} ↗
              </a>
            ) : (
              "No key set."
            )))
      }
    >
      {editing ? (
        <Input
          autoFocus
          type="password"
          autoComplete="off"
          className="w-56"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              setEditing(false);
              setValue("");
            }
          }}
          placeholder={`${label} API key`}
        />
      ) : isSet ? (
        <>
          <Button variant="ghost" size="sm" onClick={open}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={open}>
          {addLabel}
        </Button>
      )}
    </ProviderRow>
  );
}

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

function ProjectSettings({ project }: { project: Project }) {
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

function SettingsRow({
  icon: IconComponent,
  title,
  description,
  onClick,
  danger,
}: {
  icon: Icon;
  title: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable flex w-full items-center gap-3.5 px-4 py-3.5 text-left",
        danger ? "hover:bg-danger-soft" : "hover:bg-surface-2",
      )}
    >
      <IconComponent
        size={18}
        className={cn("shrink-0", danger ? "text-danger-text" : "text-fg-subtle")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-label-md", danger ? "text-danger-text" : "text-fg")}>
          {title}
        </span>
        <span className="mt-0.5 block text-body-sm text-fg-muted">{description}</span>
      </span>
      <CaretRightIcon
        size={14}
        className={cn("shrink-0", danger ? "text-danger-text" : "text-fg-subtle")}
      />
    </button>
  );
}
