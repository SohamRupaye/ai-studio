import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronRight, FileText, Brain, Gauge, Activity, Pin, X, Plus, History, Undo2, UserCog } from "lucide-react";
import { useBranches, useBranchCosts, useMemory, useArtifacts, useSnapshots, usePersonas, useActivePersona, useMutation } from "../hooks/use-ipc-data";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Rough context-window limits by model family (tokens).
// ─────────────────────────────────────────────────────────────────────────────

function contextLimitFor(model: string): number {
  if (/gemini/i.test(model)) return 1_000_000;
  if (/gpt-5|codex/i.test(model)) return 400_000;
  if (/claude/i.test(model)) return 200_000;
  if (/o1|o3|o4/i.test(model)) return 200_000;
  if (/gpt-4o/i.test(model)) return 128_000;
  return 128_000;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function RightPanel() {
  const { branchId } = useParams();
  const { activeProjectId } = useWorkspace();

  const { data: branches = [] } = useBranches();
  const branch = branchId ? branches.find((b) => b.id === branchId) : undefined;

  const { data: costEntries = [] } = useBranchCosts(branchId);
  const { data: allMemories = [] } = useMemory();
  const { data: artifacts = [] } = useArtifacts(activeProjectId);

  // Only memories visible to this context: global, this project, this chat/branch.
  const memories = allMemories.filter(
    (m) =>
      m.scope === "global" ||
      (activeProjectId && m.scope === `project:${activeProjectId}`) ||
      (branch?.chatId && m.scope === `chat:${branch.chatId}`) ||
      (branchId && m.scope === `branch:${branchId}`),
  );

  // Current context size ≈ input tokens of the most recent turn.
  const lastEntry = costEntries[costEntries.length - 1];
  const contextUsed = lastEntry?.inputTokens ?? 0;
  const contextLimit = contextLimitFor(branch?.model ?? "");
  const contextPct = Math.min(100, Math.round((contextUsed / contextLimit) * 100));

  // Usage totals across the branch.
  const usage = useMemo(
    () =>
      costEntries.reduce(
        (acc, e) => ({
          input: acc.input + e.inputTokens,
          output: acc.output + e.outputTokens,
          cost: acc.cost + e.costUsd,
        }),
        { input: 0, output: 0, cost: 0 },
      ),
    [costEntries],
  );

  const inChat = !!branchId;

  return (
    <aside className="animate-rise flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/70 bg-canvas">

      {/* Context — donut of window usage */}
      <PanelSection title="Context" icon={Gauge} defaultOpen={inChat}>
        {inChat ? (
          <div className="flex items-center gap-3">
            <Donut pct={contextPct} />
            <div className="min-w-0">
              <div className="text-sm font-medium">{contextPct}% used</div>
              <div className="text-xs text-muted-foreground">
                {fmt(contextUsed)} / {fmt(contextLimit)} tokens
              </div>
              <div className="mt-0.5 truncate font-code-sm text-muted-foreground/70">
                {branch?.model}
              </div>
            </div>
          </div>
        ) : (
          <EmptyHint>No active branch</EmptyHint>
        )}
      </PanelSection>

      {/* Persona — active agent mode for this branch */}
      <PanelSection title="Persona" icon={UserCog} defaultOpen={false}>
        {inChat ? <PersonaSelector branchId={branchId!} /> : <EmptyHint>No active branch</EmptyHint>}
      </PanelSection>

      {/* Pins — key facts/decisions pinned to this branch */}
      <PanelSection title="Pins" icon={Pin} count={branch?.pins.length} defaultOpen={inChat && !!branch?.pins.length}>
        {inChat ? <BranchPins branchId={branchId!} pins={branch?.pins ?? []} /> : <EmptyHint>No active branch</EmptyHint>}
      </PanelSection>

      {/* Memories — global facts available to the chat */}
      <PanelSection title="Memories" icon={Brain} count={memories.length} defaultOpen={inChat && memories.length > 0}>
        {memories.length === 0 ? (
          <EmptyHint>No memories referenced</EmptyHint>
        ) : (
          <div className="space-y-1.5">
            {memories.slice(0, 6).map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span className="text-xs leading-relaxed text-foreground/85">{m.text}</span>
              </div>
            ))}
            {memories.length > 6 && (
              <div className="px-2 text-[11px] text-muted-foreground">
                +{memories.length - 6} more
              </div>
            )}
          </div>
        )}
      </PanelSection>

      {/* Artifacts — documents the model can reference */}
      <PanelSection title="Artifacts" icon={FileText} count={artifacts.length} defaultOpen={artifacts.length > 0}>
        {artifacts.length === 0 ? (
          <EmptyHint>No artifacts yet</EmptyHint>
        ) : (
          <ArtifactList artifactIds={artifacts.map((a) => ({ id: a.id, title: a.title, type: a.type }))} />
        )}
      </PanelSection>

      {/* Snapshots — file changes made by the agent on this branch, revertible */}
      <PanelSection title="Snapshots" icon={History} defaultOpen={false}>
        {inChat ? <SnapshotsList branchId={branchId!} /> : <EmptyHint>No active branch</EmptyHint>}
      </PanelSection>

      {/* Usage — token + cost for this branch */}
      <PanelSection title="Usage" icon={Activity} defaultOpen={false}>
        {inChat && costEntries.length > 0 ? (
          <div className="space-y-2">
            <UsageRow label="Input" value={`${fmt(usage.input)} tok`} />
            <UsageRow label="Output" value={`${fmt(usage.output)} tok`} />
            <UsageRow label="Turns" value={String(costEntries.length)} />
            <div className="mt-1 flex items-center justify-between border-t border-border/70 pt-2">
              <span className="text-xs text-muted-foreground">Cost</span>
              <span className="font-code-sm font-medium">${usage.cost.toFixed(4)}</span>
            </div>
          </div>
        ) : (
          <EmptyHint>No usage recorded yet</EmptyHint>
        )}
      </PanelSection>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function PanelSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/70">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-[13px] font-medium">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:text-muted-foreground",
            open && "rotate-90",
          )}
        />
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}

function Donut({ pct }: { pct: number }) {
  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct > 85 ? "hsl(var(--destructive))" : pct > 60 ? "hsl(var(--warning))" : "hsl(var(--primary))";

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset var(--duration-slow) var(--easing-standard)" }}
      />
    </svg>
  );
}

function ArtifactList({
  artifactIds,
}: {
  artifactIds: { id: string; title: string; type: string }[];
}) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1">
      {artifactIds.map((a) => (
        <div
          key={a.id}
          className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50"
        >
          <input
            type="checkbox"
            checked={!!checked[a.id]}
            onChange={(e) => setChecked((prev) => ({ ...prev, [a.id]: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-input accent-[hsl(var(--primary))]"
          />
          <button
            onClick={() => navigate(`/artifacts/${a.id}`)}
            className="min-w-0 flex-1 truncate text-left text-xs text-foreground/90 hover:text-primary"
            title={a.title}
          >
            {a.title}
          </button>
          <span className="shrink-0 text-[10px] text-muted-foreground/50">{a.type}</span>
        </div>
      ))}
    </div>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/70">{children}</p>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PersonaSelector — set the active persona for this branch
// ─────────────────────────────────────────────────────────────────────────────

function PersonaSelector({ branchId }: { branchId: string }) {
  const { data: personas = [] } = usePersonas();
  const { data: active, refetch } = useActivePersona(branchId);
  const setActive = useMutation("persona:set-active");

  const handleChange = async (name: string) => {
    try {
      await setActive.mutate({ branchId, name });
      await refetch();
      toast.success(`Persona set to "${name}"`);
    } catch (err) {
      toast.error(`Failed to set persona: ${(err as Error).message}`);
    }
  };

  if (personas.length === 0) return <EmptyHint>No personas available</EmptyHint>;

  return (
    <Select value={active ?? "default"} onValueChange={handleChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {personas.map((p) => (
          <SelectItem key={p.name} value={p.name}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BranchPins — pin/unpin key facts for the active branch
// ─────────────────────────────────────────────────────────────────────────────

function BranchPins({ branchId, pins }: { branchId: string; pins: string[] }) {
  const addPin = useMutation("branch:pin-add");
  const removePin = useMutation("branch:pin-remove");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!text.trim()) return;
    try {
      await addPin.mutate({ branchId, text: text.trim() });
      setText("");
      setAdding(false);
      toast.success("Pinned");
    } catch (err) {
      toast.error(`Failed to pin: ${(err as Error).message}`);
    }
  };

  const handleRemove = async (index: number) => {
    try {
      await removePin.mutate({ branchId, index });
    } catch (err) {
      toast.error(`Failed to unpin: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-1.5">
      {pins.length === 0 && !adding && <EmptyHint>No pins yet</EmptyHint>}
      {pins.map((pin, i) => (
        <div key={i} className="group flex items-start gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
          <Pin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="flex-1 text-xs leading-relaxed text-foreground/85">{pin}</span>
          <button
            onClick={() => handleRemove(i)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            title="Unpin"
          >
            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setAdding(false); setText(""); }
            }}
            placeholder="Pin a fact or decision…"
            className="h-7 text-xs"
            autoFocus
          />
          <Button size="icon-sm" onClick={handleAdd} disabled={!text.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add pin
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotsList — file changes made by the agent on this branch, revertible
// ─────────────────────────────────────────────────────────────────────────────

function SnapshotsList({ branchId }: { branchId: string }) {
  const { data: snapshots = [], refetch } = useSnapshots(branchId);
  const revert = useMutation("snapshot:revert");

  const handleRevert = async (snapshotId: string) => {
    try {
      const result = await revert.mutate({ snapshotId });
      await refetch();
      if (result.errors.length) {
        toast.error(`Reverted with errors: ${result.errors.join(", ")}`);
      } else {
        toast.success(`Reverted ${result.reverted.length} file(s)`);
      }
    } catch (err) {
      toast.error(`Failed to revert: ${(err as Error).message}`);
    }
  };

  if (snapshots.length === 0) return <EmptyHint>No file changes tracked yet</EmptyHint>;

  return (
    <div className="space-y-1.5">
      {[...snapshots].reverse().map((s) => (
        <div key={s.id} className="rounded-lg bg-muted/60 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-foreground/85" title={s.description}>
              {s.description ?? "Snapshot"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5 shrink-0"
              onClick={() => handleRevert(s.id)}
              title="Revert this snapshot"
            >
              <Undo2 className="h-3 w-3" />
            </Button>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/70">
            {new Date(s.createdAt).toLocaleTimeString()} · {s.files.length} file(s)
          </div>
        </div>
      ))}
    </div>
  );
}
