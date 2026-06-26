import { useNavigate } from "react-router-dom";
import { FileText, Code, FileCode, BookOpen, ClipboardList } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { useWorkspace } from "../components/workspace-provider";
import { useArtifacts } from "../hooks/use-ipc-data";

// Map artifact type → icon
function typeIcon(type: string): React.ComponentType<{ className?: string }> {
  switch (type.toLowerCase()) {
    case "code":
      return Code;
    case "document":
    case "doc":
      return BookOpen;
    case "spec":
    case "specification":
      return ClipboardList;
    default:
      return FileCode;
  }
}

export default function ArtifactsPage() {
  const navigate = useNavigate();
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: artifacts = [], loading } = useArtifacts(activeProjectId);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={activeProject?.name}
        title="Artifacts"
        description="Generated code, documents, and specs extracted from your conversations."
      />

      {loading ? (
        <LoadingState />
      ) : artifacts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No artifacts yet"
          description="Artifacts are automatically extracted from chats — code blocks, documents, and specs will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.map((artifact) => {
                const Icon = typeIcon(artifact.type);
                return (
                  <TableRow
                    key={artifact.id}
                    className="cursor-pointer transition-colors hover:bg-muted/60"
                    onClick={() => navigate(`/artifacts/${artifact.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{artifact.title}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{artifact.type}</Badge>
                    </TableCell>
                    <TableCell className="font-code-sm text-right text-muted-foreground">
                      v{artifact.version}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
