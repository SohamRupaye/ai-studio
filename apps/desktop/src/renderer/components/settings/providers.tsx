import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { cn, counted, modelLabel } from "../../lib/utils";
import {
  useClaudeSession,
  useCodexStatus,
  useConfig,
  useModels,
  useMutation,
  useQuery,
} from "../../hooks/use-ipc-data";
import { ProviderTile } from "../provider-logos";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Combobox } from "../ui/combobox";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "../ui/switch";
import { FieldRow, ScopeHeader, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Providers — the account's provider connections and global API keys.
// ─────────────────────────────────────────────────────────────────────────────

// Unset providers most people reach for stay visible; the long tail hides
// behind "Show all" so the page reads as your setup, not a catalogue.
const POPULAR_PROVIDERS = new Set(["anthropic", "openai", "google", "openrouter"]);

/** models:list / disabled_models are keyed by router entry name. */
const routerEntryName = (provider: string) => (provider === "codex" ? "codex_oauth" : provider);

export function ProvidersSettings() {
  const navigate = useNavigate();
  const { data: keys } = useQuery("config:keys", undefined);
  const { data: codex } = useCodexStatus();
  const { data: claudeSession } = useClaudeSession();
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
    ...modelLabel(id),
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

          {/*
            Claude subscription — deliberately NOT a sign-in row. Squirl runs no
            OAuth flow and holds no token; the user signs into Anthropic's own
            Claude Code and the Agent SDK picks that up. So this is a toggle over
            a detected session, not a "Connect" button.
          */}
          <ProviderRow
            provider="anthropic"
            monogram="A"
            active={Boolean(claudeSession?.signedIn && claudeSession?.engineEnabled)}
            name="Claude subscription"
            badge="Active"
            hint={
              !claudeSession?.signedIn
                ? "Sign in to Claude Code on this machine, then enable this to run Claude models on your subscription instead of a billed API key."
                : claudeSession.engineEnabled
                  ? `Claude models run through your local Claude Code session${
                      claudeSession.apiKeyInEnv
                        ? " — your ANTHROPIC_API_KEY is ignored on these turns"
                        : ""
                    }. Squirl never sees your login. Note: the context inspector and the hallucination guard behave differently on these turns.`
                  : "Local Claude Code session found. Enable to run Claude models through it instead of a billed API key."
            }
          >
            <Switch
              id="claude-subscription-engine"
              checked={Boolean(claudeSession?.engineEnabled)}
              disabled={!claudeSession?.signedIn}
              onCheckedChange={(v) =>
                setConfig
                  .mutate({ claudeSubscriptionEngine: v })
                  .catch(() => toast.error("Couldn't update the Claude subscription setting"))
              }
            />
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
// Per-provider model management — every model the provider exposes, with a
// checkbox for whether it appears in selection menus. A filter, not routing:
// branches already pinned to a hidden model keep working.
// ─────────────────────────────────────────────────────────────────────────────

export function ProviderModelsPage({ provider }: { provider: string }) {
  const navigate = useNavigate();
  const { label } = providerMeta(provider);
  const name = provider === "codex" ? "Codex" : label;
  const entry = routerEntryName(provider);
  const { data: catalogue } = useQuery("models:all", undefined);
  const { data: config } = useConfig();
  const setConfig = useMutation("config:set");
  const [query, setQuery] = useState("");

  const validEntry = Object.keys(catalogue ?? {}).find((k) => k === entry);
  const models = validEntry ? (catalogue?.[validEntry] ?? []) : [];
  const disabledMap = config?.disabledModels as Record<string, string[]> | undefined;
  const disabled = new Set(
    (validEntry && disabledMap && Object.prototype.hasOwnProperty.call(disabledMap, validEntry)
      ? disabledMap[validEntry] ?? []
      : []
    ).filter(
      (m) => models.includes(m), // ignore stale entries for models that no longer exist
    ),
  );
  const enabledCount = models.length - disabled.size;
  const visible = query
    ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
    : models;

  const saveDisabled = async (next: Set<string>) => {
    if (!validEntry) return;
    try {
      await setConfig.mutate({ disabledModels: { [validEntry]: [...next] } });
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

// Shared anatomy for provider-shaped rows (key rows, the Codex account row):
// neutral tile holding the provider's monochrome mark in currentColor (raised
// and brightened when active — elevation and tone mean state, never a colored
// chip), name + status badge, hint line, actions at the trailing edge.
export function ProviderRow({
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
export function ProviderKeyRow({
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
