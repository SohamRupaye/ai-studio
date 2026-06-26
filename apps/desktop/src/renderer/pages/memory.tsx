import { useState, useMemo } from "react";
import { Brain, Plus, Trash2, Sparkles } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select";
import { useMemory, useMutation } from "../hooks/use-ipc-data";
import { useWorkspace } from "../components/workspace-provider";
import { toast } from "sonner";

/** Human-readable label for a memory scope string. */
function scopeLabel(scope: string, projectName?: string): string {
  if (scope === "global") return "Global";
  if (scope.startsWith("project:")) return projectName ? `Project · ${projectName}` : "Project";
  if (scope.startsWith("chat:")) return "Chat";
  if (scope.startsWith("branch:")) return "Branch";
  return scope;
}

export default function MemoryPage() {
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: facts = [], loading, refetch } = useMemory();
  const addFact = useMutation("memory:add");
  const removeFact = useMutation("memory:remove");

  const [text, setText] = useState("");
  const [scopeKind, setScopeKind] = useState<"global" | "project">("project");

  // Show global memories + those belonging to the active project.
  const visibleFacts = useMemo(
    () =>
      facts.filter(
        (f) => f.scope === "global" || (activeProjectId && f.scope === `project:${activeProjectId}`),
      ),
    [facts, activeProjectId],
  );

  const handleAdd = async () => {
    if (!text.trim()) return;
    const scope =
      scopeKind === "project" && activeProjectId ? `project:${activeProjectId}` : "global";
    try {
      await addFact.mutate({ text: text.trim(), scope });
      await refetch();
      setText("");
      toast.success("Memory added");
    } catch (err) {
      toast.error(`Failed to add memory: ${(err as Error).message}`);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeFact.mutate({ id });
      await refetch();
      toast.success("Memory removed");
    } catch (err) {
      toast.error(`Failed to remove: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeProject?.name}
        title="Memory"
        description="Facts the AI remembers. Project memories apply within this project; global ones apply everywhere."
      />

      {/* Add fact */}
      <Card className="mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] text-muted-foreground">New fact</span>
          <Input
            placeholder="e.g. Prefers TypeScript with strict mode enabled"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-44">
          <span className="text-[13px] text-muted-foreground">Scope</span>
          <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as "global" | "project")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project" disabled={!activeProjectId}>
                This project{activeProject ? ` · ${activeProject.name}` : ""}
              </SelectItem>
              <SelectItem value="global">Global (all projects)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleAdd} disabled={!text.trim() || addFact.loading}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </Card>

      {loading ? (
        <LoadingState />
      ) : visibleFacts.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No memories yet"
          description="Add facts the AI should always remember — preferences, conventions, or context."
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {visibleFacts.map((fact) => (
            <div
              key={fact.id}
              className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{fact.text}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="secondary">{scopeLabel(fact.scope, activeProject?.name)}</Badge>
                  <Text size="xs" variant="subtle">
                    {new Date(fact.createdAt).toLocaleDateString()}
                  </Text>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => handleRemove(fact.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
