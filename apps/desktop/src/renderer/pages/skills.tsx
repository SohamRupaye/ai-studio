import { Sparkles, Wrench } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import { useSkills } from "../hooks/use-ipc-data";

export default function SkillsPage() {
  const { data: skills = [], loading } = useSkills();

  return (
    <PageContainer wide>
      <PageHeader
        title="Skills"
        description="Markdown-defined skills loaded from your data directory's skills/ folder. The agent can invoke these by name."
      />

      {loading ? (
        <LoadingState />
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No skills loaded"
          description="Add a *.md file to your data directory's skills/ folder — each file becomes a named skill with a description, allowed tools, and instructions."
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {skills.map((skill) => (
            <div key={skill.name} className="flex items-start gap-3 px-5 py-4">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{skill.name}</span>
                {skill.description && (
                  <Text size="sm" variant="muted" className="mt-1">
                    {skill.description}
                  </Text>
                )}
                {skill.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Wrench className="h-3 w-3 text-muted-foreground/60" />
                    {skill.tools.map((tool) => (
                      <Badge key={tool} variant="secondary" className="font-code-sm">
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
