import { useState } from "react";
import { Server, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2, ShieldAlert } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select";
import { useMCPServers, useMutation } from "../hooks/use-ipc-data";
import type { MCPTransport } from "@ai-studio/event-bus";
import { toast } from "sonner";

function StatusBadge({ status }: { status: { status: string; error?: string; attempt?: number } }) {
  switch (status.status) {
    case "connected":
      return (
        <Badge variant="success">
          <CheckCircle2 className="h-3 w-3" />
          Connected
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" title={status.error}>
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "reconnecting":
      return (
        <Badge variant="warning">
          <Loader2 className="h-3 w-3 animate-spin" />
          Reconnecting{status.attempt ? ` (${status.attempt})` : ""}
        </Badge>
      );
    case "needs_auth":
      return (
        <Badge variant="warning">
          <ShieldAlert className="h-3 w-3" />
          Needs auth
        </Badge>
      );
    default:
      return <Badge variant="secondary">Disabled</Badge>;
  }
}

export default function MCPServersPage() {
  const { data: servers = [], loading, refetch } = useMCPServers();
  const addServer = useMutation("mcp:add");
  const removeServer = useMutation("mcp:remove");
  const reconnectServer = useMutation("mcp:reconnect");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<MCPTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(""); setType("stdio"); setCommand(""); setArgs(""); setUrl("");
    setShowForm(false);
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addServer.mutate({
        name: name.trim(),
        type,
        ...(type === "stdio"
          ? { command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : undefined }
          : { url: url.trim() }),
      });
      await refetch();
      resetForm();
      toast.success(`MCP server "${name.trim()}" added`);
    } catch (err) {
      toast.error(`Failed to add server: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (serverName: string) => {
    try {
      await removeServer.mutate({ name: serverName });
      await refetch();
      toast.success(`Removed "${serverName}"`);
    } catch (err) {
      toast.error(`Failed to remove: ${(err as Error).message}`);
    }
  };

  const handleReconnect = async (serverName: string) => {
    try {
      await reconnectServer.mutate({ name: serverName });
      await refetch();
      toast.success(`Reconnecting "${serverName}"…`);
    } catch (err) {
      toast.error(`Failed to reconnect: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="MCP servers"
        description="Connect Model Context Protocol servers to extend the agent with external tools."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add server
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New MCP server</CardTitle>
            <CardDescription>Stdio servers run a local command; SSE/HTTP servers connect to a URL.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Name</span>
                <Input placeholder="e.g. filesystem" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Transport</span>
                <Select value={type} onValueChange={(v) => setType(v as MCPTransport)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio (local command)</SelectItem>
                    <SelectItem value="sse">SSE (remote)</SelectItem>
                    <SelectItem value="http">HTTP (remote)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {type === "stdio" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-muted-foreground">Command</span>
                  <Input placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} className="font-code-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] text-muted-foreground">Args (space-separated)</span>
                  <Input placeholder="-y @modelcontextprotocol/server-filesystem /path" value={args} onChange={(e) => setArgs(e.target.value)} className="font-code-sm" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">URL</span>
                <Input placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} className="font-code-sm" />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!name.trim() || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add server
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No MCP servers connected"
          description="Add a server to give the agent access to external tools and resources."
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {servers.map((entry) => (
            <div key={entry.config.name} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{entry.config.name}</span>
                  <Badge variant="outline">{entry.config.type}</Badge>
                  <StatusBadge status={entry.status} />
                </div>
                <Text size="xs" variant="muted" className="mt-1 font-code-sm">
                  {entry.config.type === "stdio"
                    ? `${entry.config.command ?? ""} ${(entry.config.args ?? []).join(" ")}`.trim()
                    : entry.config.url}
                </Text>
                {entry.status.status === "failed" && entry.status.error && (
                  <Text size="xs" variant="muted" className="mt-1 text-destructive">
                    {entry.status.error}
                  </Text>
                )}
                {entry.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.tools.map((t) => (
                      <Badge key={t.name} variant="secondary" className="font-code-sm" title={t.description}>
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="ghost" size="icon-sm" title="Reconnect" onClick={() => handleReconnect(entry.config.name)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" title="Remove" onClick={() => handleRemove(entry.config.name)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
