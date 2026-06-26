import { UserCog, Wrench, ShieldBan } from "lucide-react";
import { PageContainer, PageHeader, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import { usePersonas } from "../hooks/use-ipc-data";
import { useWorkspace } from "../components/workspace-provider";

/**
 * Read-only catalog of available personas. Personas are set per-branch from
 * the chat's right panel (where there's an active branch to apply them to);
 * this page exists so users can browse what's available and what each one
 * restricts before picking it there.
 */
export default function PersonasPage() {
  const { data: personas = [], loading } = usePersonas();
  const { activeProject } = useWorkspace();

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeProject?.name}
        title="Personas"
        description="Named agent modes with distinct system prompts and tool access. Set the active persona for a chat from its right panel."
      />

      {loading ? (
        <LoadingState />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {personas.map((persona) => (
            <div key={persona.name} className="flex items-start gap-3 px-5 py-4">
              <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{persona.name}</span>
                  {persona.model && <Badge variant="secondary" className="font-code-sm">{persona.model}</Badge>}
                </div>
                {persona.description && (
                  <Text size="sm" variant="muted" className="mt-1">
                    {persona.description}
                  </Text>
                )}
                {persona.allowedTools && persona.allowedTools.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Wrench className="h-3 w-3 text-muted-foreground/60" />
                    {persona.allowedTools.map((tool) => (
                      <Badge key={tool} variant="secondary" className="font-code-sm">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                )}
                {persona.deniedTools && persona.deniedTools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ShieldBan className="h-3 w-3 text-muted-foreground/60" />
                    {persona.deniedTools.map((tool) => (
                      <Badge key={tool} variant="destructive" className="font-code-sm">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
