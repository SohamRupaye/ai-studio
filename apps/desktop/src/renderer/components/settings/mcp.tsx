import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@phosphor-icons/react";
import type { MCPServerEntry, MCPTransport } from "@squirl/event-bus";
import { cn, counted } from "../../lib/utils";
import { useMCPServers, useMutation } from "../../hooks/use-ipc-data";
import { ProviderTile } from "../provider-logos";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ButtonGroup, ButtonGroupItem } from "../ui/button-group";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScopeHeader, SettingsSection } from "./shared";
import { ProviderRow } from "./providers";

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

export function MCPSettings() {
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
