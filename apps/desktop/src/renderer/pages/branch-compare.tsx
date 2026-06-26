import { useState, useMemo } from "react";
import { GitCompare, ArrowRight, Minus, Plus, Equal } from "lucide-react";
import type { BranchDiff } from "@ai-studio/event-bus";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Heading, Text } from "../components/ui/typography";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "../components/ui/select";
import { useWorkspace } from "../components/workspace-provider";
import { useChats, useBranches } from "../hooks/use-ipc-data";
import { toast } from "sonner";

export default function BranchComparePage() {
  const { activeProjectId } = useWorkspace();
  const { data: chats = [] } = useChats(activeProjectId);
  const { data: allBranches = [] } = useBranches();

  const chatIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  const branches = useMemo(
    () => allBranches.filter((b) => b.chatId && chatIds.has(b.chatId)),
    [allBranches, chatIds],
  );

  // Group branches by their parent chat so same-named branches (e.g. every
  // chat's default "main") stay disambiguated in the dropdown.
  const chatNameOf = (chatId: string | undefined) =>
    chats.find((c) => c.id === chatId)?.name ?? "Untitled chat";

  const groupedBranches = useMemo(() => {
    const groups = new Map<string, { chatName: string; branches: typeof branches }>();
    for (const b of branches) {
      const chatId = b.chatId ?? "";
      if (!groups.has(chatId)) groups.set(chatId, { chatName: chatNameOf(b.chatId), branches: [] });
      groups.get(chatId)!.branches.push(b);
    }
    return Array.from(groups.values());
  }, [branches, chats]);

  const [branchA, setBranchA] = useState<string>("");
  const [branchB, setBranchB] = useState<string>("");
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [loading, setLoading] = useState(false);

  const compare = async () => {
    if (!branchA || !branchB) return;
    if (branchA === branchB) {
      toast.error("Select two different branches");
      return;
    }
    setLoading(true);
    try {
      const result = await window.ipc.invoke("branch:compare", {
        branchIdA: branchA,
        branchIdB: branchB,
      });
      setDiff(result);
    } catch (err) {
      toast.error(`Compare failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Label a branch as "<chat name> / <branch name> (<model>)" so identical
  // branch names across different chats (e.g. "main") are distinguishable.
  const labelOf = (id: string) => {
    const b = branches.find((x) => x.id === id);
    if (!b) return "—";
    return `${chatNameOf(b.chatId)} / ${b.name} (${b.model})`;
  };
  const nameOf = labelOf;

  return (
    <PageContainer wide>
      <PageHeader
        title="Compare branches"
        description="See how decisions diverge between two branches."
      />

      {branches.length < 2 ? (
        <EmptyState
          icon={GitCompare}
          title="Need at least two branches"
          description="Create and use multiple branches to compare their decisions."
        />
      ) : (
        <>
          {/* Selectors */}
          <Card className="mb-6 flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-[13px] text-muted-foreground">Branch A</span>
              <Select value={branchA} onValueChange={setBranchA}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch">
                    {branchA ? labelOf(branchA) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groupedBranches.map((group, i) => (
                    <SelectGroup key={group.chatName + i}>
                      {i > 0 && <SelectSeparator />}
                      <SelectLabel>{group.chatName}</SelectLabel>
                      {group.branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} <span className="text-muted-foreground">({b.model})</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex h-9 items-center justify-center text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-[13px] text-muted-foreground">Branch B</span>
              <Select value={branchB} onValueChange={setBranchB}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch">
                    {branchB ? labelOf(branchB) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groupedBranches.map((group, i) => (
                    <SelectGroup key={group.chatName + i}>
                      {i > 0 && <SelectSeparator />}
                      <SelectLabel>{group.chatName}</SelectLabel>
                      {group.branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} <span className="text-muted-foreground">({b.model})</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={compare} disabled={!branchA || !branchB || loading}>
              <GitCompare className="h-4 w-4" />
              Compare
            </Button>
          </Card>

          {/* Results */}
          {loading ? (
            <LoadingState label="Comparing branches…" />
          ) : diff ? (
            <div className="space-y-6">
              {diff.commonAncestor && (
                <Text size="sm" variant="muted">
                  Common ancestor: <span className="font-code-sm">{diff.commonAncestor}</span>
                </Text>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <DiffColumn
                  title={`Only in ${nameOf(branchA)}`}
                  icon={Minus}
                  accent="destructive"
                  items={diff.onlyInA.map((d) => ({ topic: d.topic, detail: d.decision }))}
                />
                <DiffColumn
                  title={`Only in ${nameOf(branchB)}`}
                  icon={Plus}
                  accent="success"
                  items={diff.onlyInB.map((d) => ({ topic: d.topic, detail: d.decision }))}
                />
              </div>

              {/* Shared */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Equal className="h-4 w-4 text-muted-foreground" />
                  <Heading size="h4">Shared decisions</Heading>
                  <Badge variant="secondary">{diff.shared.length}</Badge>
                </div>
                {diff.shared.length === 0 ? (
                  <Text size="sm" variant="muted">
                    No shared decisions.
                  </Text>
                ) : (
                  <Card className="divide-y divide-border/70 overflow-hidden">
                    {diff.shared.map((s, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="text-xs font-medium text-muted-foreground">{s.topic}</div>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-md bg-muted/50 p-2 text-sm">{s.decisionA}</div>
                          <div className="rounded-md bg-muted/50 p-2 text-sm">{s.decisionB}</div>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={GitCompare}
              title="Select two branches"
              description="Pick branch A and B above, then hit Compare."
            />
          )}
        </>
      )}
    </PageContainer>
  );
}

function DiffColumn({
  title,
  icon: Icon,
  accent,
  items,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "destructive" | "success";
  items: { topic: string; detail: string }[];
}) {
  const color = accent === "destructive" ? "text-destructive" : "text-success";
  const edge = accent === "destructive" ? "border-l-destructive/60" : "border-l-success/60";
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <Heading size="h4">{title}</Heading>
        <Badge variant={accent === "destructive" ? "destructive" : "success"}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <Text size="sm" variant="muted">
          Nothing unique.
        </Text>
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {items.map((item, i) => (
            <div key={i} className={`border-l-2 px-4 py-3 ${edge}`}>
              <div className="text-xs font-medium text-muted-foreground">{item.topic}</div>
              <div className="mt-1 text-sm">{item.detail}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
