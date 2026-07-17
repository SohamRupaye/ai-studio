import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClockCountdownIcon, DotsThreeIcon } from "@phosphor-icons/react";
import type { Automation } from "@squirl/shared";
import { cn } from "../../lib/utils";
import { useMutation, useQuery } from "../../hooks/use-ipc-data";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { ConfirmDialog } from "../confirm-dialog";
import { ScopeHeader, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Automations — scheduled recurring agent runs. Created from chat (the
// create_automation tool); this page is the management surface. Each run
// appends a real turn to the automation's branch — the transcript is the log.
// ─────────────────────────────────────────────────────────────────────────────

export function AutomationsSettings() {
  const { data: automations, loading, refetch } = useQuery("automation:list", undefined);
  const [doomed, setDoomed] = useState<Automation | null>(null);
  const deleteAutomation = useMutation("automation:delete");

  // Live refresh when a run fires or the agent creates/changes one mid-chat.
  useEffect(() => {
    const off = window.ipc.on("automations:changed", () => refetch());
    return off;
  }, [refetch]);

  return (
    <>
      <ScopeHeader
        title="Automations"
        hint="Recurring tasks the agent runs on a schedule — only while the app is open. Each run lands as a normal turn on the automation's chat branch."
      />
      <SettingsSection title="Scheduled tasks">
        {loading && !automations ? null : !automations?.length ? (
          <p className="mt-3 text-body-sm text-fg-subtle">
            No automations yet. Ask the agent in any chat — “every morning at 8, summarize my
            calendar” — and it will schedule one here.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {automations.map((a) => (
              <AutomationRow key={a.id} automation={a} onDelete={() => setDoomed(a)} />
            ))}
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(open) => { if (!open) setDoomed(null); }}
        title="Delete automation?"
        description={`“${doomed?.name}” will stop running. Turns it already produced stay in the chat.`}
        onConfirm={async () => {
          if (!doomed) return;
          try {
            await deleteAutomation.mutate({ id: doomed.id });
          } catch {
            toast.error(`Couldn't delete ${doomed.name}`);
          }
          setDoomed(null);
        }}
      />
    </>
  );
}

function AutomationRow({ automation: a, onDelete }: { automation: Automation; onDelete: () => void }) {
  const toggle = useMutation("automation:toggle");

  const nextLine = !a.enabled
    ? "Disabled"
    : a.nextRunAt
      ? `Next run ${new Date(a.nextRunAt).toLocaleString()}`
      : "Not scheduled";

  return (
    <div className="group/row flex min-h-14 items-center gap-3.5 px-4 py-2.5">
      <ClockCountdownIcon size={18} className={cn("shrink-0", a.enabled ? "text-fg" : "text-fg-subtle")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-label-md", a.enabled ? "text-fg" : "text-fg-muted")}>
          {a.name}
          {a.lastStatus === "error" && <span className="ml-2 text-body-sm text-danger-text">last run failed</span>}
        </span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
          <span className="font-mono">{a.schedule}</span>
          <span> · {nextLine}</span>
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={a.enabled}
          aria-label={`${a.name} enabled`}
          onCheckedChange={(checked) =>
            toggle
              .mutate({ id: a.id, enabled: checked })
              .catch(() => toast.error(`Couldn't ${checked ? "enable" : "disable"} ${a.name}`))
          }
        />
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`${a.name} actions`} />}
          >
            <DotsThreeIcon size={16} weight="bold" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onClick={onDelete}>Delete…</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}
