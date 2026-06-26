import { useMemo } from "react";
import { Network, MessageSquare, GitBranch, FileText } from "lucide-react";
import { PageContainer, PageHeader, EmptyState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Text } from "../components/ui/typography";
import { useWorkspace } from "../components/workspace-provider";
import { useChats, useBranches, useArtifacts } from "../hooks/use-ipc-data";

// Knowledge node types mapped to the design-system viz palette.
const NODE_TYPES = [
  { label: "Conversation", className: "bg-viz-node-conversation" },
  { label: "Decision", className: "bg-viz-node-decision" },
  { label: "Code", className: "bg-viz-node-code" },
  { label: "Reference", className: "bg-viz-node-reference" },
  { label: "Task", className: "bg-viz-node-task" },
  { label: "Issue", className: "bg-viz-node-issue" },
  { label: "Note", className: "bg-viz-node-note" },
  { label: "Unknown", className: "bg-viz-node-unknown" },
];

export default function GraphPage() {
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: chats = [] } = useChats(activeProjectId);
  const { data: allBranches = [] } = useBranches();
  const { data: artifacts = [] } = useArtifacts(activeProjectId);

  const chatIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  const projectBranches = allBranches.filter((b) => b.chatId && chatIds.has(b.chatId));

  const hasData = chats.length > 0 || artifacts.length > 0;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeProject?.name}
        title="Knowledge graph"
        description="A map of conversations, decisions, and artifacts and how they connect."
      />

      {/* Summary chips */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SummaryChip icon={MessageSquare} label="Chats" value={chats.length} />
        <SummaryChip icon={GitBranch} label="Branches" value={projectBranches.length} />
        <SummaryChip icon={FileText} label="Artifacts" value={artifacts.length} />
      </div>

      {/* Canvas */}
      <Card className="relative mb-6 flex min-h-[46vh] items-center justify-center overflow-hidden">
        {/* dotted grid background */}
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "radial-gradient(circle, hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative">
          {hasData ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <Network className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <Text size="sm" className="font-medium">
                  Interactive graph rendering coming soon
                </Text>
                <Text size="xs" variant="muted" className="mt-1 max-w-sm">
                  Your knowledge nodes are being indexed. The force-directed visualization will render
                  here.
                </Text>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Network}
              title="No knowledge yet"
              description="Start a conversation to begin building your project's knowledge graph."
            />
          )}
        </div>
      </Card>

      {/* Legend */}
      <div>
        <span className="text-[13px] text-muted-foreground">Node types</span>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {NODE_TYPES.map((n) => (
            <div key={n.label} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${n.className}`} />
              <Text size="sm" variant="muted">
                {n.label}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

function SummaryChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-card px-3 py-1.5">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium tabular-nums">{value}</span>
      <Text size="xs" variant="muted">
        {label}
      </Text>
    </div>
  );
}
