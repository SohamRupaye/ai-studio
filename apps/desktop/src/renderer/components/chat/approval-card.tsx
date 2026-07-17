import { useState } from "react";
import { ShieldWarningIcon } from "@phosphor-icons/react";
import { Button } from "../ui";
import { Checkbox } from "../ui";

export interface PendingApproval {
  id: string;
  name: string;
  summary: string;
}

/**
 * Inline pause card: a side-effecting tool call is waiting on the user.
 * The turn is blocked in main until a decision lands (or the 5-minute
 * timeout denies), so this renders in the composer footer where the user's
 * attention already is. "Always allow" persists a PermissionStore rule —
 * future calls to this tool skip the card entirely (manageable in
 * Settings → General → Tool permissions).
 */
export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const [always, setAlways] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const decide = (allowed: boolean) => {
    setDeciding(true);
    // The approval_resolved stream event clears the card — no local unmount.
    window.ipc.invoke("chat:approval-decision", { id: approval.id, allowed, always }).catch(() => {
      setDeciding(false);
    });
  };

  return (
    <div className="mb-2 rounded-lg border border-line bg-warning-soft px-3.5 py-2.5 text-body-sm text-warning-text">
      <div className="flex items-center gap-2.5">
        <ShieldWarningIcon size={16} className="shrink-0" />
        <span className="shrink-0">Approve tool call?</span>
        <span className="min-w-0 flex-1 truncate font-mono text-body-sm" title={approval.summary}>
          {approval.name}
          {approval.summary ? <span className="opacity-70"> {approval.summary}</span> : null}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 pl-[26px]">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-body-sm">
          <Checkbox checked={always} onCheckedChange={(v) => setAlways(Boolean(v))} />
          Always allow this tool
        </label>
        <Button variant="secondary" size="sm" disabled={deciding} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button variant="primary" size="sm" disabled={deciding} onClick={() => decide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}
