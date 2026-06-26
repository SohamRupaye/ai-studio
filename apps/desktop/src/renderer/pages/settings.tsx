import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Sun, Moon, Monitor, KeyRound, DollarSign, ChevronRight, Server, Sparkles, ShieldCheck, UserCog } from "lucide-react";
import { PageContainer, PageHeader } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Text } from "../components/ui/typography";
import { useTheme } from "../hooks/use-theme";
import { useAuth } from "../components/auth-provider";
import { useMutation, useConfig } from "../hooks/use-ipc-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const THEMES = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { user, refresh } = useAuth();
  const setUser = useMutation("user:set");

  const [name, setName] = useState("");

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    try {
      await setUser.mutate({ name: name.trim() });
      await refresh();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(`Failed to update: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Manage your profile, appearance, and preferences." />

      <div className="space-y-6">
        {/* General */}
        <Card className="divide-y divide-border/70">
          <SettingRow title="Appearance" description="Choose how AI Studio looks.">
            <div className="flex items-center gap-0.5 rounded-lg border border-border/80 bg-canvas p-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
                    theme === t.value
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow title="Display name" description="Your display name in the workspace.">
            <div className="flex items-center gap-2">
              <Input
                id="name"
                aria-label="Name"
                className="w-52"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
              <Button onClick={handleSaveProfile} disabled={!name.trim() || setUser.loading}>
                Save
              </Button>
            </div>
          </SettingRow>
        </Card>

        {/* Links to sub-settings */}
        <Card className="divide-y divide-border/70 overflow-hidden">
          <SettingsLink
            icon={KeyRound}
            title="Model providers"
            description="Manage API keys and available models"
            onClick={() => navigate("/settings/models")}
          />
          <SettingsLink
            icon={Server}
            title="MCP servers"
            description="Connect Model Context Protocol servers for extra tools"
            onClick={() => navigate("/settings/mcp-servers")}
          />
          <SettingsLink
            icon={Sparkles}
            title="Skills"
            description="View skills loaded from your skills folder"
            onClick={() => navigate("/settings/skills")}
          />
          <SettingsLink
            icon={ShieldCheck}
            title="Permissions"
            description="Review and revoke saved tool permission decisions"
            onClick={() => navigate("/settings/permissions")}
          />
          <SettingsLink
            icon={UserCog}
            title="Personas"
            description="Browse agent modes with distinct prompts and tool access"
            onClick={() => navigate("/settings/personas")}
          />
          <SettingsLink
            icon={DollarSign}
            title="Cost tracker"
            description="View token usage and spending"
            onClick={() => navigate("/settings/costs")}
          />
        </Card>

        {/* Classifier toggle */}
        <Card className="divide-y divide-border/70">
          <ClassifierSetting />
        </Card>
      </div>
    </PageContainer>
  );
}

function ClassifierSetting() {
  const { data: config, loading, refetch } = useConfig();
  const setConfig = useMutation("config:set");
  const [saving, setSaving] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      await setConfig.mutate({ classifierEnabled: enabled });
      await refetch();
      toast.success(enabled ? "Classifier enabled" : "Classifier disabled");
    } catch (err) {
      toast.error(`Failed to update: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title="Knowledge classifier"
      description="Automatically classify and index conversation turns into the knowledge graph."
    >
      <Switch
        checked={!loading && !!(config as { classifierEnabled?: boolean } | undefined)?.classifierEnabled}
        onCheckedChange={handleToggle}
        disabled={loading || saving}
      />
    </SettingRow>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && (
          <Text size="xs" variant="muted" className="mt-0.5">
            {description}
          </Text>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsLink({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <Text size="xs" variant="muted" className="mt-0.5">
          {description}
        </Text>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </button>
  );
}
