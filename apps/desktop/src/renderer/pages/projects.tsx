import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderKanban, Plus, Check, Building2 } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Text } from "../components/ui/typography";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { useWorkspace } from "../components/workspace-provider";
import { useMutation } from "../hooks/use-ipc-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const {
    projects,
    activeOrg,
    activeOrgId,
    activeProjectId,
    setActiveProjectId,
    refetchProjects,
    loading,
  } = useWorkspace();
  const createProject = useMutation("project:create");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = async () => {
    if (!name.trim() || !activeOrgId) return;
    try {
      const project = await createProject.mutate({ orgId: activeOrgId, name: name.trim() });
      await refetchProjects();
      setActiveProjectId(project.id);
      toast.success(`Created project "${project.name}"`);
      setName("");
      setOpen(false);
    } catch (err) {
      toast.error(`Failed to create project: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeOrg?.name}
        title="Projects"
        description="Projects hold your chats, artifacts, and knowledge."
        actions={
          <Button onClick={() => setOpen(true)} disabled={!activeOrgId}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        }
      />

      {!activeOrgId ? (
        <EmptyState
          icon={Building2}
          title="No organization selected"
          description="Select or create an organization first."
          action={<Button onClick={() => navigate("/orgs")}>Go to organizations</Button>}
        />
      ) : loading && projects.length === 0 ? (
        <LoadingState />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects"
          description="Create your first project to start working."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {projects.map((project) => {
            const active = activeProjectId === project.id;
            return (
              <button
                key={project.id}
                onClick={() => {
                  setActiveProjectId(project.id);
                  navigate("/");
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <Text size="xs" variant="muted">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </Text>
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Create a project in {activeOrg?.name ?? "your organization"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || createProject.loading}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
