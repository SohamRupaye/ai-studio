import { XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTheme } from "../../hooks/use-theme";
import { useMutation, useQuery } from "../../hooks/use-ipc-data";
import { useUiPrefs } from "../ui-prefs";
import { ButtonGroup, ButtonGroupItem } from "../ui/button-group";
import { Switch } from "../ui/switch";
import { FieldRow, ScopeHeader, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// General — app-wide preferences
// ─────────────────────────────────────────────────────────────────────────────

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const { toolCallDetail, setToolCallDetail, notifyMode, setNotifyMode, notifySound, setNotifySound } =
    useUiPrefs();

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

      <SettingsSection title="Chat">
        <div className="mt-2 divide-y divide-line">
          <FieldRow
            label="Tool call details"
            hint="Expand tool calls in the transcript to see each call's input and output. Rows still show what ran either way."
            htmlFor="tool-call-detail"
          >
            <Switch
              id="tool-call-detail"
              checked={toolCallDetail}
              onCheckedChange={setToolCallDetail}
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <ToolPermissionsSection />

      <MemorySection />

      <LocalBrowserSection />

      <SettingsSection
        title="Notifications"
        hint="Get pinged when a chat's reply finishes — handy for long agent runs you leave to work while you're elsewhere."
      >
        <div className="mt-2 divide-y divide-line">
          <FieldRow
            label="Desktop notifications"
            hint="“When away” only notifies while AI Studio isn't the focused window."
          >
            <ButtonGroup value={notifyMode} onValueChange={(v) => setNotifyMode(v as typeof notifyMode)}>
              <ButtonGroupItem value="off">Off</ButtonGroupItem>
              <ButtonGroupItem value="unfocused">When away</ButtonGroupItem>
              <ButtonGroupItem value="always">Always</ButtonGroupItem>
            </ButtonGroup>
          </FieldRow>
          <FieldRow
            label="Notification sound"
            hint="Play the system sound with the notification."
            htmlFor="notify-sound"
          >
            <Switch
              id="notify-sound"
              checked={notifySound}
              disabled={notifyMode === "off"}
              onCheckedChange={setNotifySound}
            />
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

/**
 * Living-memory inference toggle. Off by default — inferred facts are a
 * lower-confidence, quarantined memory type (labeled "inferred", never
 * override a stated fact). Supersession/enrichment/forgetting all work
 * without this; it only enables the model deriving new facts from patterns.
 */
function MemorySection() {
  const { data: cfg } = useQuery("config:get", undefined);
  const setCfg = useMutation("config:set");
  const enabled = Boolean(cfg?.memoryInference);

  return (
    <SettingsSection title="Memory">
      <div className="mt-2 divide-y divide-line">
        <FieldRow
          label="Infer new facts"
          hint="Let Squirl derive likely facts from patterns across your memories. Inferences are marked and never replace things you actually told it. Off by default."
          htmlFor="memory-inference"
        >
          <Switch
            id="memory-inference"
            checked={enabled}
            onCheckedChange={(v) =>
              setCfg
                .mutate({ memoryInference: v })
                .catch(() => toast.error("Couldn't update the memory setting"))
            }
          />
        </FieldRow>
      </div>
    </SettingsSection>
  );
}

/**
 * Opt-in local-browser tools. Off by default — they drive a real Chrome
 * window using the user's own logged-in profile, so enabling is a deliberate
 * act. Enabling takes effect immediately (main reconciles on config:set).
 */
function LocalBrowserSection() {
  const { data: cfg } = useQuery("config:get", undefined);
  const setBrowser = useMutation("config:set");
  const enabled = Boolean(cfg?.browserToolEnabled);

  return (
    <SettingsSection title="Local browser">
      <div className="mt-2 divide-y divide-line">
        <FieldRow
          label="Let agents use a local browser"
          hint="Agents can drive a separate Chrome window using your own logged-in profile — for pages that need a real browser, sign-in, or block automation. Sessions stay on this machine; typed values are never saved to the transcript."
          htmlFor="browser-tool"
        >
          <Switch
            id="browser-tool"
            checked={enabled}
            onCheckedChange={(v) =>
              setBrowser
                .mutate({ browserToolEnabled: v })
                .catch(() => toast.error("Couldn't update the local browser setting"))
            }
          />
        </FieldRow>
      </div>
    </SettingsSection>
  );
}

/**
 * "Always allow" rules saved from the chat's tool-approval card. Rendered
 * only when at least one rule exists — with none saved, there's nothing to
 * manage and the approval card explains itself in context.
 */
function ToolPermissionsSection() {
  const { data: rules } = useQuery("permissions:list", undefined);
  const removeRule = useMutation("permissions:remove");
  const allowed = (rules ?? []).filter((r) => r.decision === "allow");
  if (!allowed.length) return null;

  return (
    <SettingsSection
      title="Tool permissions"
      hint="Tools you marked “Always allow” run without an approval card. Remove a rule to be asked again."
    >
      <div className="mt-2 divide-y divide-line">
        {allowed.map((r) => (
          <div key={`${r.tool}:${r.pattern ?? ""}`} className="group/rule flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-fg">{r.tool}</span>
            <span className="shrink-0 text-body-sm text-fg-subtle">Always allowed</span>
            <button
              type="button"
              aria-label={`Remove rule for ${r.tool}`}
              className="pressable shrink-0 rounded-sm p-1 text-fg-subtle opacity-0 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover/rule:opacity-100"
              onClick={() => removeRule.mutate({ tool: r.tool, pattern: r.pattern })}
            >
              <XIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
