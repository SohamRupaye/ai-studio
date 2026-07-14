import { useState, type ReactNode } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MemoryFact, SelectableArtifact } from "@squirl/event-bus";
import {
  useActivePersona,
  useBranchArtifacts,
  useBranchCosts,
  useBranchMemories,
  useContextStats,
  useMutation,
  usePersonas,
} from "../hooks/use-ipc-data";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { MeterRing } from "./ui/meter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Separator } from "./ui/separator";

// ─────────────────────────────────────────────────────────────────────────────
// Right panel — the context inspector. Branch pages only. Answers one
// question: what will the model see next turn, and what did that cost.
// Chrome, like the left sidebar: sits on bare canvas, page card stays the
// raised hero. Spacing grammar: every section shares the same trigger row
// (px-1 py-2.5) and content block (px-1 pb-3.5), separated by hairlines.
//
// Progressive disclosure (the "information overload" fix): a COLLAPSED
// section's header carries its one-glance summary (0% · Default · $0.0092),
// so the panel at rest is five quiet rows; content exists only when the user
// drills in. Everything starts collapsed except Context; each section
// remembers its expand state in localStorage.
// See context/plan.md for the two-phase plan.
// ─────────────────────────────────────────────────────────────────────────────

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);
const fmtCost = (c: number) => `$${c < 0.1 ? c.toFixed(4) : c.toFixed(2)}`;
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function RightPanel({ branchId }: { branchId: string }) {
  const { data: stats } = useContextStats(branchId);
  const memories = useBranchMemories(branchId);
  const artifacts = useBranchArtifacts(branchId);
  const costs = useBranchCosts(branchId);
  const { data: personas } = usePersonas();
  const activePersona = useActivePersona(branchId);

  const totalCost = (costs.data ?? []).reduce((sum, c) => sum + c.costUsd, 0);

  // Projection: what the next turn's context looks like with the CURRENT
  // artifact selection — last turn's total, minus the artifact block it
  // carried, plus the selection as it stands now. Small deltas are wrapper
  // noise (the block's own tags), not a real change.
  const selectedIds = new Set(artifacts.data?.selected ?? []);
  const selectedTokens = (artifacts.data?.artifacts ?? [])
    .filter((a) => selectedIds.has(a.id))
    .reduce((sum, a) => sum + a.tokens, 0);
  const projectedTokens =
    stats && Math.abs(selectedTokens - stats.artifactTokens) > 64
      ? Math.max(0, stats.tokenEstimate - stats.artifactTokens + selectedTokens)
      : null;

  const displayTokens = projectedTokens ?? stats?.tokenEstimate;
  const contextPct =
    stats && displayTokens !== undefined && stats.contextLimit > 0
      ? Math.min(Math.round((displayTokens / stats.contextLimit) * 100), 100)
      : null;

  return (
    <aside className="flex h-full w-[280px] flex-col overflow-y-auto px-3 pb-4">
      <Section title="Context" summary={contextPct !== null ? `${contextPct}%` : undefined} defaultOpen>
        {stats ? <ContextStatsView stats={stats} projectedTokens={projectedTokens} /> : (
          <EmptyNote>Send a message to see what the model used.</EmptyNote>
        )}
      </Section>

      <Separator />

      <Section title="Persona" summary={personaLabel(activePersona.data ?? "default")}>
        <PersonaView branchId={branchId} personas={personas} active={activePersona} />
      </Section>

      <Separator />

      <Section
        title="Artifacts"
        summary={
          artifacts.data?.artifacts.length
            ? `${selectedIds.size}/${artifacts.data.artifacts.length}`
            : "0"
        }
      >
        {artifacts.error ? (
          <ErrorNote label="Couldn't load artifacts" onRetry={artifacts.refetch} />
        ) : !artifacts.data?.artifacts.length ? (
          <EmptyNote>No artifacts in this project yet.</EmptyNote>
        ) : (
          <ArtifactsView branchId={branchId} data={artifacts.data} />
        )}
      </Section>

      <Separator />

      <Section title="Memories" summary={`${memories.data?.length ?? 0}`}>
        {memories.error ? (
          <ErrorNote label="Couldn't load memories" onRetry={memories.refetch} />
        ) : !memories.data?.length ? (
          <EmptyNote>No memories feed this branch yet.</EmptyNote>
        ) : (
          <MemoriesView facts={memories.data} onRemoved={memories.refetch} />
        )}
      </Section>

      <Separator />

      <Section title="Usage" summary={totalCost > 0 ? fmtCost(totalCost) : undefined}>
        {costs.error ? (
          <ErrorNote label="Couldn't load usage" onRetry={costs.refetch} />
        ) : !costs.data?.length ? (
          <EmptyNote>No turns yet.</EmptyNote>
        ) : (
          <UsageView costs={costs.data} />
        )}
      </Section>
    </aside>
  );
}

// ── Section grammar ───────────────────────────────────────────────────────────

// Collapsed = header + one-glance summary; expanded = content only (the
// summary hides — the content says it better). Expand state persists per
// section so the panel at rest is whatever the user tuned it to.
function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const storageKey = `ai-studio:panel:${title.toLowerCase()}`;
  const [open, setOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === "open";
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    localStorage.setItem(storageKey, next ? "open" : "closed");
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="w-full min-w-0 px-1 py-2.5 text-label-md text-fg-muted hover:text-fg">
        <span className="flex-1 truncate text-left">{title}</span>
        {!open && summary !== undefined && (
          <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{summary}</span>
        )}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-1 pb-3.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-body-sm text-fg-subtle">{children}</p>;
}

function ErrorNote({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <p className="text-body-sm text-fg-subtle">
      {label}.{" "}
      <button type="button" onClick={onRetry} className="text-fg-muted underline underline-offset-2 hover:text-fg">
        Retry
      </button>
    </p>
  );
}

// ── Context ───────────────────────────────────────────────────────────────────

// Ring + one number, nothing else by default: the tier breakdown only lists
// tiers that are actually contributing, so a fresh chat reads as one quiet
// line instead of a wall of zeros. When the artifact selection changed since
// the last turn, the ring shows the PROJECTED fill, marked "≈".
function ContextStatsView({
  stats,
  projectedTokens,
}: {
  stats: NonNullable<ReturnType<typeof useContextStats>["data"]>;
  projectedTokens: number | null;
}) {
  const shown = projectedTokens ?? stats.tokenEstimate;
  const pct = stats.contextLimit > 0
    ? Math.min(Math.round((shown / stats.contextLimit) * 100), 100)
    : 0;
  const tiers = ([
    ["Recent turns", stats.tierHot],
    ["Inherited from parent", stats.tierAncestry],
    ["Compacted summaries", stats.tierWarm],
    ["Retrieved from graph", stats.tierRetrieved],
  ] as Array<[string, number]>).filter(([, v]) => v > 0);

  return (
    <div>
      <div className="flex items-center gap-3">
        <MeterRing value={shown} max={stats.contextLimit} aria-label="Context window usage">
          <span className="font-mono text-[11px] text-fg">{pct}%</span>
        </MeterRing>
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-fg">
            {projectedTokens !== null && <span className="text-fg-muted">≈ </span>}
            {fmtTokens(shown)} / {fmtTokens(stats.contextLimit)}
          </p>
          <p className="mt-0.5 text-body-sm text-fg-subtle">
            {projectedTokens !== null
              ? "tokens · with current selection"
              : `tokens · as of ${fmtTime(stats.capturedAt)}`}
          </p>
        </div>
      </div>
      {tiers.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {tiers.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-body-sm text-fg-muted">{label}</span>
              <span className="shrink-0 font-mono text-[11px] text-fg">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

// The phase-2 teeth: a checked artifact is attached to this branch's prompt
// (<selected_artifacts> in buildPayload). Selection spans the whole project —
// the point is pulling a doc from ANY branch into this one's context.
function ArtifactsView({
  branchId,
  data,
}: {
  branchId: string;
  data: { selected: string[]; artifacts: SelectableArtifact[] };
}) {
  const setSelection = useMutation("branch:artifacts-set");

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...data.selected, id]
      : data.selected.filter((s) => s !== id);
    setSelection
      .mutate({ branchId, artifactIds: next })
      .catch(() => toast.error("Couldn't update the selection"));
  };

  const groups: Array<[string, SelectableArtifact[]]> = [
    ["This branch", data.artifacts.filter((a) => a.fromThisBranch)],
    ["Elsewhere in the project", data.artifacts.filter((a) => !a.fromThisBranch)],
  ];
  const bothGroups = groups.every(([, list]) => list.length > 0);

  return (
    <div className="space-y-3">
      {groups.map(([label, list]) => {
        if (!list.length) return null;
        return (
          <div key={label}>
            {bothGroups && <p className="pb-1 text-label-sm text-fg-subtle">{label}</p>}
            <ul className="space-y-0.5">
              {list.map((a) => {
                const checked = data.selected.includes(a.id);
                return (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-surface-1">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => toggle(a.id, Boolean(next))}
                        aria-label={`Attach "${a.title}" to this branch's context`}
                      />
                      <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{a.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                        {fmtTokens(a.tokens)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {data.selected.length > 0 && (
        <p className="text-body-sm leading-relaxed text-fg-subtle">
          Checked artifacts are sent to the model with every turn on this branch.
        </p>
      )}
    </div>
  );
}

// ── Persona ───────────────────────────────────────────────────────────────────

const personaLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function PersonaView({
  branchId,
  personas,
  active,
}: {
  branchId: string;
  personas: ReturnType<typeof usePersonas>["data"];
  active: ReturnType<typeof useActivePersona>;
}) {
  const setActive = useMutation("persona:set-active");

  if (!personas?.length) return <EmptyNote>No personas available.</EmptyNote>;

  const current = personas.find((p) => p.name === (active.data ?? "default"));

  return (
    <div className="space-y-2">
      <Select
        items={Object.fromEntries(personas.map((p) => [p.name, personaLabel(p.name)]))}
        value={active.data ?? "default"}
        onValueChange={(name) => {
          if (typeof name !== "string" || name === active.data) return;
          setActive
            .mutate({ branchId, name })
            .then(() => active.refetch())
            .catch(() => toast.error("Couldn't switch personas"));
        }}
      >
        <SelectTrigger className="h-7 w-full min-w-0 bg-surface-1 text-body-sm shadow-none hover:bg-surface-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {personas.map((p) => (
            <SelectItem key={p.name} value={p.name}>
              {personaLabel(p.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current?.description && (
        <p className="text-body-sm leading-relaxed text-fg-subtle">{current.description}</p>
      )}
    </div>
  );
}

// ── Memories ──────────────────────────────────────────────────────────────────

const SCOPE_ORDER: Array<[string, (scope: string) => boolean]> = [
  ["Global", (s) => s === "global"],
  ["Project", (s) => s.startsWith("project:")],
  ["Chat", (s) => s.startsWith("chat:")],
  ["Branch", (s) => s.startsWith("branch:")],
];

function MemoriesView({ facts, onRemoved }: { facts: MemoryFact[]; onRemoved: () => void }) {
  const removeMemory = useMutation("memory:remove");

  const remove = async (id: number) => {
    try {
      await removeMemory.mutate({ id });
      onRemoved();
    } catch {
      toast.error("Couldn't remove that memory");
    }
  };

  return (
    <div className="space-y-3">
      {SCOPE_ORDER.map(([label, match]) => {
        const group = facts.filter((f) => match(f.scope));
        if (!group.length) return null;
        return (
          <div key={label}>
            <p className="pb-1 text-label-sm text-fg-subtle">{label}</p>
            <ul className="space-y-1.5">
              {group.map((f) => (
                <li key={f.id} className="group/memory flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-body-sm leading-relaxed text-fg-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                    {f.text}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove memory"
                    onClick={() => remove(f.id)}
                    className="pressable mt-0.5 shrink-0 rounded-sm p-0.5 text-fg-subtle opacity-0 hover:text-danger-text focus-visible:opacity-100 group-hover/memory:opacity-100"
                  >
                    <TrashIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Usage ─────────────────────────────────────────────────────────────────────

// Per model, not per turn: the question this answers is "where is the money
// going", and the answer is a model, not a timestamp.
function UsageView({
  costs,
}: {
  costs: Array<{ model: string; costUsd: number; timestamp: number }>;
}) {
  const byModel = new Map<string, { cost: number; turns: number }>();
  for (const c of costs) {
    const entry = byModel.get(c.model) ?? { cost: 0, turns: 0 };
    entry.cost += c.costUsd;
    entry.turns += 1;
    byModel.set(c.model, entry);
  }
  const rows = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);

  return (
    <ul className="space-y-1.5">
      {rows.map(([model, { cost, turns }]) => (
        <li key={model} className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-muted">{model}</span>
          <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
            {turns} {turns === 1 ? "turn" : "turns"}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-fg">{fmtCost(cost)}</span>
        </li>
      ))}
    </ul>
  );
}
