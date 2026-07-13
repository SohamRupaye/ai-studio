import { useEffect, useRef, useState } from "react";
import { TreeStructureIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Markdown } from "../ui/markdown";
import { Spinner } from "../ui/spinner";
import { TypingDots } from "./message-parts";
import { toolIcon } from "./tool-icon";
import type { SubagentRun } from "./types";

/** Live elapsed-time ticker for a running agent. */
function Elapsed({ since }: { since: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatDuration(Date.now() - since)}</>;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** One delegated agent under its subagent/delegate call — click opens the
 * transcript drawer. Shows the current tool + elapsed time while running. */
export function SubagentRow({ run, onClick }: { run: SubagentRun; onClick?: (run: SubagentRun) => void }) {
  const lastStep = run.steps[run.steps.length - 1];
  const currentTool =
    run.status === "running" && lastStep?.type === "tool" && lastStep.success === undefined
      ? lastStep.tool
      : undefined;
  return (
    <button
      type="button"
      onClick={() => onClick?.(run)}
      className="pressable group/agent ml-5 flex items-center gap-2 rounded-md border-l border-line py-1 pl-3 pr-2 text-left hover:bg-surface-2"
    >
      <span
        className={
          run.status === "failed" ? "flex shrink-0 text-danger-text" : "flex shrink-0 text-fg-subtle"
        }
      >
        {run.status === "running" ? (
          <Spinner size="sm" />
        ) : run.status === "failed" ? (
          <WarningCircleIcon size={14} />
        ) : (
          <TreeStructureIcon size={14} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted group-hover/agent:text-fg">
        {run.agentId}
      </span>
      {currentTool && (
        <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{currentTool}</span>
      )}
      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
        {run.status === "running" && run.startedAt ? (
          <Elapsed since={run.startedAt} />
        ) : run.durationMs !== undefined ? (
          formatDuration(run.durationMs)
        ) : null}
      </span>
      {run.model && (
        <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{run.model}</span>
      )}
    </button>
  );
}

/** One transcript step: a stretch of the agent's own text (markdown) or a
 * tool call with its args and outcome preview. */
function SubagentStepView({ step, active }: { step: SubagentRun["steps"][number]; active: boolean }) {
  if (step.type === "text") {
    return (
      <div className="text-body-sm">
        <Markdown text={step.text ?? ""} />
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={
            step.success === false ? "flex shrink-0 text-danger-text" : "flex shrink-0 text-fg-subtle"
          }
        >
          {active ? <Spinner size="sm" /> : toolIcon(step.tool ?? "")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted">
          {step.tool}
        </span>
        {step.success === false && (
          <WarningCircleIcon size={14} className="shrink-0 text-danger-text" />
        )}
      </div>
      {step.args && step.args !== "{}" && (
        <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{step.args}</div>
      )}
      {step.resultPreview && (
        <div className="mt-1 line-clamp-2 font-mono text-[11px] text-fg-subtle">
          → {step.resultPreview}
        </div>
      )}
    </div>
  );
}

/** The full transcript of one delegated agent — everything it writes and
 * every tool call, streamed live. A NON-MODAL drawer (no backdrop): the point
 * is watching the agent alongside the chat, not focusing into a modal. */
export function SubagentDetailDrawer({
  run,
  onClose,
}: {
  run: SubagentRun | null;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Follow the transcript while the agent works (the drawer is a live view;
  // scrolling history mid-run is what the persisted record is for).
  useEffect(() => {
    const el = bodyRef.current;
    if (el && run?.status === "running") el.scrollTop = el.scrollHeight;
  }, [run]);

  return (
    <Drawer open={run !== null} onOpenChange={(open) => !open && onClose()} modal={false}>
      {run && (
        <DrawerContent showBackdrop={false}>
          <DrawerHeader className="border-b border-line">
            <DrawerTitle className="flex items-center gap-2.5">
              {run.status === "running" && <Spinner size="sm" />}
              <span className="min-w-0 truncate font-mono text-[15px]">{run.agentId}</span>
              {run.status === "failed" && (
                <span className="shrink-0 text-body-sm font-normal text-danger-text">failed</span>
              )}
            </DrawerTitle>
            <DrawerDescription className="flex items-center gap-2 font-mono text-[12px]">
              {run.model && <span>{run.model}</span>}
              <span>
                {run.status === "running" && run.startedAt ? (
                  <Elapsed since={run.startedAt} />
                ) : run.durationMs !== undefined ? (
                  formatDuration(run.durationMs)
                ) : null}
              </span>
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody ref={bodyRef} className="flex flex-col gap-3 py-4">
            {run.task && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Task</h4>
                <p className="whitespace-pre-wrap text-body-sm text-fg-muted">{run.task}</p>
              </section>
            )}
            {(run.steps.length > 0 || run.status === "running") && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">
                  Transcript
                </h4>
                <div className="flex flex-col gap-2">
                  {run.steps.map((step, i) => (
                    <SubagentStepView
                      key={i}
                      step={step}
                      active={
                        run.status === "running" &&
                        i === run.steps.length - 1 &&
                        step.type === "tool" &&
                        step.success === undefined
                      }
                    />
                  ))}
                  {run.status === "running" && <TypingDots />}
                </div>
              </section>
            )}
            {run.error && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Error</h4>
                <p className="whitespace-pre-wrap text-body-sm text-danger-text">{run.error}</p>
              </section>
            )}
            {/* The transcript already contains everything the agent wrote — a
                separate Result section only serves records persisted before
                transcripts existed. */}
            {run.result && !run.steps.some((s) => s.type === "text") && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Result</h4>
                <Markdown text={run.result} />
              </section>
            )}
          </DrawerBody>
        </DrawerContent>
      )}
    </Drawer>
  );
}
