import { useMemo } from "react";
import { DollarSign, ArrowDownToLine, ArrowUpFromLine, GitBranch } from "lucide-react";
import type { Branch } from "@ai-studio/shared";
import { PageContainer, PageHeader, StatCard, EmptyState } from "../components/page-primitives";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../components/ui/table";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { useWorkspace } from "../components/workspace-provider";
import {
  useChats,
  useBranches,
  useProjectCosts,
  useBranchCosts,
} from "../hooks/use-ipc-data";

function fmtTokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const quietHead =
  "font-sans text-[13px] font-normal normal-case tracking-normal text-muted-foreground";

export default function CostTrackerPage() {
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: chats = [] } = useChats(activeProjectId);
  const { data: allBranches = [] } = useBranches();
  const { data: costs } = useProjectCosts(activeProjectId);

  const chatIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  const projectBranches = useMemo(
    () => allBranches.filter((b) => b.chatId && chatIds.has(b.chatId)),
    [allBranches, chatIds],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeProject?.name}
        title="Cost tracker"
        description="Token usage and estimated spend across this project."
      />

      {/* Summary */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total spend"
          value={`$${(costs?.totalCost ?? 0).toFixed(4)}`}
          icon={DollarSign}
        />
        <StatCard
          label="Input tokens"
          value={fmtTokens(costs?.totalInput ?? 0)}
          icon={ArrowDownToLine}
        />
        <StatCard
          label="Output tokens"
          value={fmtTokens(costs?.totalOutput ?? 0)}
          icon={ArrowUpFromLine}
        />
      </div>

      {/* Per-branch breakdown */}
      {projectBranches.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No usage yet"
          description="Costs will appear here once you start chatting."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={quietHead}>Branch</TableHead>
                <TableHead className={quietHead}>Model</TableHead>
                <TableHead className={`${quietHead} text-right`}>Input</TableHead>
                <TableHead className={`${quietHead} text-right`}>Output</TableHead>
                <TableHead className={`${quietHead} text-right`}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectBranches.map((branch) => (
                <BranchCostRow key={branch.id} branch={branch} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  );
}

function BranchCostRow({ branch }: { branch: Branch }) {
  const { data: entries = [] } = useBranchCosts(branch.id);

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          input: acc.input + e.inputTokens,
          output: acc.output + e.outputTokens,
          cost: acc.cost + e.costUsd,
        }),
        { input: 0, output: 0, cost: 0 },
      ),
    [entries],
  );

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{branch.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-code-sm">
          {branch.model}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-code-sm tabular-nums text-muted-foreground">
        {fmtTokens(totals.input)}
      </TableCell>
      <TableCell className="text-right font-code-sm tabular-nums text-muted-foreground">
        {fmtTokens(totals.output)}
      </TableCell>
      <TableCell className="text-right font-code-md tabular-nums">
        ${totals.cost.toFixed(4)}
      </TableCell>
    </TableRow>
  );
}
