import { useState } from "react";
import { CaretRightIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cn, counted } from "../../lib/utils";
import { useUiPrefs } from "../ui-prefs";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { SubagentRow } from "./subagents";
import { toolIcon } from "./tool-icon";
import type { SubagentRun, ToolCallState } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tool activity — collapsible list of a turn's tool calls, same grammar as
// the "Explored 4 files" marker in the gallery. Rendered live while
// streaming and again (from the persisted message) once the turn lands, so
// what the assistant DID stays visible alongside what it said.
// ─────────────────────────────────────────────────────────────────────────────

/** Groups live agent runs by runId (first-seen order) and attaches each group
 * to the turn's subagent/delegate calls in invocation order — the same
 * matching main uses when it persists the message. */
export function attachLiveAgents(calls: ToolCallState[], runs: SubagentRun[]): ToolCallState[] {
  if (!runs.length) return calls;
  const groups: SubagentRun[][] = [];
  const groupIdx = new Map<string, number>();
  for (const r of runs) {
    let i = groupIdx.get(r.runId ?? "");
    if (i === undefined) {
      i = groups.length;
      groupIdx.set(r.runId ?? "", i);
      groups.push([]);
    }
    groups[i]!.push(r);
  }
  let gi = 0;
  return calls.map((c) =>
    (c.name === "subagent" || c.name === "delegate") && gi < groups.length
      ? { ...c, agents: groups[gi++] }
      : c,
  );
}

export function ToolActivity({
  calls,
  onAgentClick,
}: {
  calls: ToolCallState[];
  onAgentClick?: (run: SubagentRun) => void;
}) {
  const running = calls.some((c) => c.status === "running");
  const failed = calls.filter((c) => c.status === "error").length;
  return (
    <Collapsible defaultOpen className="mb-1.5">
      <CollapsibleTrigger className="py-1">
        {running ? <Spinner size="sm" /> : <CheckIcon size={12} weight="bold" />}
        {counted(calls.length, "tool call")}
        {failed > 0 && <span className="text-danger-text">· {failed} failed</span>}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-1 pb-1.5 pl-1.5 pt-2.5">
          {calls.map((call, i) => (
            <div key={i} className="flex flex-col gap-1">
              <ToolCallRow call={call} />
              {call.agents?.map((agent) => (
                <SubagentRow
                  key={`${agent.runId ?? ""}:${agent.agentId}`}
                  run={agent}
                  onClick={onAgentClick}
                />
              ))}
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** One tool call: the row leads with the salient argument (the command, the
 * URL, the query); clicking expands the call's full input and result. The
 * Settings → General "Tool call details" toggle turns the expansion off —
 * rows still say what ran either way. */
function ToolCallRow({ call }: { call: ToolCallState }) {
  const { toolCallDetail } = useUiPrefs();
  const [open, setOpen] = useState(false);
  const result = call.result;
  const hasDetail = toolCallDetail && Boolean(call.args || result);
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group/call flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left",
          hasDetail && "pressable hover:bg-surface-2",
        )}
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center text-fg-subtle [&>svg]:size-3.5",
            call.status === "error" && "text-danger-text",
          )}
        >
          {call.status === "running" ? <Spinner size="sm" /> : toolIcon(call.name)}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 font-mono text-[12px] text-fg-muted">
          <span className="shrink-0">{call.name}</span>
          {call.summary && (
            <span className="min-w-0 truncate text-[11px] text-fg-subtle">{call.summary}</span>
          )}
        </span>
        {call.status === "error" && (
          <WarningCircleIcon size={14} className="shrink-0 text-danger-text" />
        )}
        {hasDetail && (
          <CaretRightIcon
            size={11}
            weight="bold"
            className={cn(
              "shrink-0 text-fg-subtle opacity-0 transition-transform duration-200 ease-(--ease-standard) group-hover/call:opacity-100",
              open && "rotate-90 opacity-100",
            )}
          />
        )}
      </button>
      {open && hasDetail && (
        <div className="ml-6 mt-1 flex min-w-0 flex-col gap-1.5 pb-1">
          {call.args && <ToolDetailBlock label="Input" text={call.args} />}
          {result && (
            <ToolDetailBlock
              label={call.status === "error" ? "Error" : "Result"}
              text={result}
              danger={call.status === "error"}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ToolDetailBlock({ label, text, danger }: { label: string; text: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={cn("text-label-sm text-fg-subtle", danger && "text-danger-text")}>{label}</span>
      <pre
        className={cn(
          "max-h-56 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-1 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-muted",
          danger && "border-danger-soft text-danger-text",
        )}
      >
        {text}
      </pre>
    </div>
  );
}
