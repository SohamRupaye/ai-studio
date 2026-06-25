import { useState } from "react";
import { Building2, Plus, Check } from "lucide-react";
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

export default function OrgsPage() {
  const { orgs, activeOrgId, setActiveOrgId, refetchOrgs, loading } = useWorkspace();
  const createOrg = useMutation("org:create");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const org = await createOrg.mutate({ name: name.trim() });
      await refetchOrgs();
      setActiveOrgId(org.id);
      toast.success(`Created organization "${org.name}"`);
      setName("");
      setOpen(false);
    } catch (err) {
      toast.error(`Failed to create organization: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Organizations"
        description="Group your projects under organizations."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            New organization
          </Button>
        }
      />

      {loading && orgs.length === 0 ? (
        <LoadingState />
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organizations"
          description="Create your first organization to get started."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New organization
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {orgs.map((org) => {
            const active = activeOrgId === org.id;
            return (
              <button
                key={org.id}
                onClick={() => setActiveOrgId(org.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{org.name}</div>
                  <Text size="xs" variant="muted">
                    Created {new Date(org.createdAt).toLocaleDateString()}
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
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>
              Organizations group related projects together.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || createOrg.loading}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
