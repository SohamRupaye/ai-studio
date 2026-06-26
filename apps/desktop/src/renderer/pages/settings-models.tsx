import { useState } from "react";
import { Eye, EyeOff, Save, CheckCircle2, LogOut, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader, LoadingState } from "../components/page-primitives";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import { useModels, useCodexStatus, useMutation } from "../hooks/use-ipc-data";
import { toast } from "sonner";

/**
 * Every key-based provider supported by the backend router
 * (packages/providers/src/config.ts → API_KEY_PROVIDERS), grouped for display.
 * Codex OAuth is excluded — it authenticates separately and needs no key.
 */
interface ProviderMeta {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
}

const PROVIDER_GROUPS: { label: string; providers: ProviderMeta[] }[] = [
  {
    label: "Core",
    providers: [
      { key: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", hint: "Claude models" },
      { key: "openai", label: "OpenAI", placeholder: "sk-…", hint: "GPT-4o, o3, o4" },
      { key: "google", label: "Google AI", placeholder: "AIza…", hint: "Gemini models" },
      { key: "openrouter", label: "OpenRouter", placeholder: "sk-or-…", hint: "Free + aggregated models" },
    ],
  },
  {
    label: "Direct providers",
    providers: [
      { key: "mistral", label: "Mistral", placeholder: "…", hint: "Mistral, Codestral, Magistral" },
      { key: "deepseek", label: "DeepSeek", placeholder: "sk-…", hint: "DeepSeek Chat, Reasoner" },
      { key: "xai", label: "xAI", placeholder: "xai-…", hint: "Grok models" },
      { key: "cohere", label: "Cohere", placeholder: "…", hint: "Command models" },
      { key: "perplexity", label: "Perplexity", placeholder: "pplx-…", hint: "Sonar models" },
      { key: "alibaba", label: "Alibaba (DashScope)", placeholder: "sk-…", hint: "Qwen models" },
    ],
  },
  {
    label: "Multi-vendor inference hosts",
    providers: [
      { key: "groq", label: "Groq", placeholder: "gsk_…", hint: "Llama, GPT-OSS (fast inference)" },
      { key: "cerebras", label: "Cerebras", placeholder: "csk-…", hint: "Llama, Qwen (fast inference)" },
      { key: "together", label: "Together AI", placeholder: "…", hint: "Llama, DeepSeek, Qwen" },
      { key: "fireworks", label: "Fireworks", placeholder: "fw_…", hint: "Llama, DeepSeek" },
      { key: "deepinfra", label: "DeepInfra", placeholder: "…", hint: "Llama, Qwen" },
      { key: "nvidia", label: "NVIDIA NIM", placeholder: "nvapi-…", hint: "Llama, Qwen Coder" },
    ],
  },
];

const ALL_PROVIDERS = PROVIDER_GROUPS.flatMap((g) => g.providers);

export default function ModelSettingsPage() {
  const { data: models = {}, loading, refetch } = useModels();
  const setConfig = useMutation("config:set");

  const [keys, setKeys] = useState<Record<string, string>>(
    () => Object.fromEntries(ALL_PROVIDERS.map((p) => [p.key, ""])),
  );
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setConfig.mutate({
        apiKeys: Object.fromEntries(ALL_PROVIDERS.map((p) => [p.key, keys[p.key] ?? ""])),
      });
      await refetch();
      toast.success("Provider keys saved");
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Model providers"
        description="Connect AI providers and view available models."
        actions={
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            Save keys
          </Button>
        }
      />

      {/* Codex OAuth account */}
      <CodexAccountCard />

      {/* API keys */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>Keys are stored locally and never leave your device.</CardDescription>
        </CardHeader>
        <div className="mt-2">
          {PROVIDER_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-6 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {group.label}
              </div>
              <div className="divide-y divide-border/70 border-t border-border/70">
                {group.providers.map((p) => {
                  const configured = !!models[p.key]?.length;
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-6 px-6 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{p.label}</span>
                          {configured && (
                            <Badge variant="success">
                              <CheckCircle2 className="h-3 w-3" />
                              Connected
                            </Badge>
                          )}
                        </div>
                        <Text size="xs" variant="muted" className="mt-0.5">
                          {p.hint}
                        </Text>
                      </div>
                      <div className="relative w-64 shrink-0">
                        <Input
                          type={visible[p.key] ? "text" : "password"}
                          placeholder={p.placeholder}
                          value={keys[p.key] ?? ""}
                          autoComplete="off"
                          className="pr-9 font-code-sm"
                          onChange={(e) => setKeys((prev) => ({ ...prev, [p.key]: e.target.value }))}
                        />
                        <button
                          type="button"
                          onClick={() => setVisible((v) => ({ ...v, [p.key]: !v[p.key] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {visible[p.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Available models */}
      <Card>
        <CardHeader>
          <CardTitle>Available models</CardTitle>
          <CardDescription>Models you can select when creating a chat.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState />
          ) : Object.keys(models).length === 0 ? (
            <Text size="sm" variant="muted">
              No providers connected yet. Add a key above to unlock models.
            </Text>
          ) : (
            <div className="space-y-5">
              {Object.entries(models).map(([provider, ids]) => (
                <div key={provider}>
                  <div className="text-[13px] text-muted-foreground">{provider}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ids.map((id) => (
                      <Badge key={id} variant="secondary" className="font-code-sm">
                        {id}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

// ── Codex OAuth account card ─────────────────────────────────────────────────

function CodexAccountCard() {
  const { data: status, loading, refetch } = useCodexStatus();
  const login = useMutation("codex:login");
  const logout = useMutation("codex:logout");
  const switchAccount = useMutation("codex:switch-account");
  const [busy, setBusy] = useState<"login" | "logout" | "switch" | null>(null);

  const handleLogin = async () => {
    setBusy("login");
    try {
      await login.mutate(undefined);
      await refetch();
      toast.success("Codex account connected");
    } catch (err) {
      toast.error(`Login failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = async () => {
    setBusy("logout");
    try {
      await logout.mutate(undefined);
      await refetch();
      toast.success("Signed out of Codex");
    } catch (err) {
      toast.error(`Logout failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSwitchAccount = async () => {
    setBusy("switch");
    try {
      // Opens the browser login flow again; the user can sign in with a
      // different ChatGPT account before the app picks up the new session.
      await switchAccount.mutate(undefined);
      await refetch();
      toast.success("Switched Codex account");
    } catch (err) {
      toast.error(`Switch account failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Codex (GPT-5)</CardTitle>
        <CardDescription>Signed in via ChatGPT OAuth — no API key needed.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState />
        ) : (
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {status?.connected ? status.email ?? "Connected account" : "Not connected"}
                </span>
                {status?.connected && (
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </Badge>
                )}
              </div>
              {status?.connected && status.accountId && (
                <Text size="xs" variant="muted" className="mt-0.5 font-code-sm">
                  Account ID: {status.accountId}
                </Text>
              )}
              {!status?.connected && (
                <Text size="xs" variant="muted" className="mt-0.5">
                  Sign in with a ChatGPT account to enable GPT-5 models.
                </Text>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status?.connected ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleSwitchAccount} disabled={busy !== null}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Switch account
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleLogout} disabled={busy !== null}>
                    <LogOut className="h-3.5 w-3.5" />
                    Log out
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={handleLogin} disabled={busy !== null}>
                  Connect Codex
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
