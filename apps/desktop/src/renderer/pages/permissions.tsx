import { ShieldCheck, ShieldX, Trash2, ShieldOff } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import { usePermissions, useMutation } from "../hooks/use-ipc-data";
import { toast } from "sonner";

export default function PermissionsPage() {
  const { data: rules = [], loading, refetch } = usePermissions();
  const removeRule = useMutation("permissions:remove");
  const clearRules = useMutation("permissions:clear");

  const handleRemove = async (tool: string, pattern?: string) => {
    try {
      await removeRule.mutate({ tool, pattern });
      await refetch();
      toast.success(`Revoked permission for "${tool}"`);
    } catch (err) {
      toast.error(`Failed to revoke: ${(err as Error).message}`);
    }
  };

  const handleClear = async () => {
    try {
      await clearRules.mutate(undefined);
      await refetch();
      toast.success("Cleared all permissions");
    } catch (err) {
      toast.error(`Failed to clear: ${(err as Error).message}`);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Permissions"
        description={'"Always allow" and "always deny" decisions you\'ve made for tools, saved across sessions.'}
        actions={
          rules.length > 0 ? (
            <Button variant="outline" onClick={handleClear} disabled={clearRules.loading}>
              <ShieldOff className="h-4 w-4" />
              Clear all
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingState />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No saved permissions"
          description="When you approve or deny a tool call and choose to remember the decision, it will appear here."
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {rules.map((rule, i) => (
            <div key={`${rule.tool}-${rule.pattern ?? ""}-${i}`} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {rule.decision === "allow" ? (
                    <ShieldCheck className="h-4 w-4 text-success" />
                  ) : (
                    <ShieldX className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-medium">{rule.tool}</span>
                  <Badge variant={rule.decision === "allow" ? "success" : "destructive"}>
                    {rule.decision === "allow" ? "Always allow" : "Always deny"}
                  </Badge>
                  <Badge variant="secondary">{rule.scope}</Badge>
                </div>
                {rule.pattern && (
                  <Text size="xs" variant="muted" className="mt-1 font-code-sm">
                    Pattern: {rule.pattern}
                  </Text>
                )}
                <Text size="xs" variant="subtle" className="mt-0.5">
                  {new Date(rule.createdAt).toLocaleString()}
                </Text>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => handleRemove(rule.tool, rule.pattern)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
