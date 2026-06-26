import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, FileText } from "lucide-react";
import { PageContainer, PageHeader, LoadingState, EmptyState } from "../components/page-primitives";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useArtifact, useMutation } from "../hooks/use-ipc-data";
import { toast } from "sonner";

export default function ArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: artifact, loading, refetch } = useArtifact(id);
  const updateArtifact = useMutation("artifact:update");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (artifact) {
      setTitle(artifact.title);
      setContent(artifact.content);
      setDirty(false);
    }
  }, [artifact]);

  const handleSave = async () => {
    if (!id) return;
    try {
      await updateArtifact.mutate({ id, content, title });
      await refetch();
      setDirty(false);
      toast.success("Artifact saved");
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    }
  };

  if (loading) return <LoadingState label="Loading artifact…" />;

  if (!artifact) {
    return (
      <PageContainer>
        <EmptyState
          icon={FileText}
          title="Artifact not found"
          description="This artifact may have been removed."
          action={<Button onClick={() => navigate("/artifacts")}>Back to artifacts</Button>}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={artifact.type}
        title={artifact.title}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/artifacts")}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || updateArtifact.loading}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="max-w-md"
          placeholder="Artifact title"
        />
        <Badge variant="secondary" className="font-code-sm">
          v{artifact.version}
        </Badge>
        {dirty && <Badge variant="warning">Unsaved</Badge>}
      </div>

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        spellCheck={false}
        className="font-code-md min-h-[60vh] w-full resize-none rounded-xl border border-border/80 bg-card p-4 text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25"
        placeholder="Artifact content…"
      />
    </PageContainer>
  );
}
