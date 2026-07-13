import { useTheme } from "../../hooks/use-theme";
import { useUiPrefs } from "../ui-prefs";
import { ButtonGroup, ButtonGroupItem } from "../ui/button-group";
import { Switch } from "../ui/switch";
import { FieldRow, ScopeHeader, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// General — app-wide preferences
// ─────────────────────────────────────────────────────────────────────────────

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const { toolCallDetail, setToolCallDetail } = useUiPrefs();

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

      <p className="mt-9 text-body-sm text-fg-subtle">
        Provider accounts, API keys and models live under Providers; external tools under MCP
        servers.
      </p>
    </>
  );
}
