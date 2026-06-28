import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, GitBranch, MessageSquarePlus, FolderKanban } from "lucide-react";
import { PageContainer, PageHeader, EmptyState } from "../components/page-primitives";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useWorkspace } from "../components/workspace-provider";
import { useModels, useMutation } from "../hooks/use-ipc-data";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Quiet sentence-case labels (overrides the mono/uppercase Label default).
const labelClass = "font-sans text-[13px] font-medium normal-case tracking-normal text-foreground";

export default function NewChatPage() {
  const navigate = useNavigate();
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: models = {} } = useModels();
  const createChat = useMutation("chat:create");
  const createBranch = useMutation("branch:create");

  const [name, setName] = useState("");
  const [model, setModel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Flatten provider → model map into a list; default to the first model.
  const modelList = useMemo(
    () => Object.entries(models).flatMap(([provider, ids]) => ids.map((id) => ({ provider, id }))),
    [models],
  );

  useEffect(() => {
    if (!model && modelList.length > 0) setModel(modelList[0].id);
  }, [modelList, model]);

  const handleCreate = async () => {
    if (!activeProjectId || !model) return;
    const chatName = name.trim() || "New Chat";
    setSubmitting(true);
    try {
      const chat = await createChat.mutate({ projectId: activeProjectId, name: chatName });
      const branch = await createBranch.mutate({ name: "main", model, chatId: chat.id });
      toast.success(`Created "${chatName}"`);
      navigate(`/chat/${branch.id}`);
    } catch (err) {
      toast.error(`Failed to create chat: ${(err as Error).message}`);
      setSubmitting(false);
    }
  };

  if (!activeProjectId) {
    return (
      <PageContainer>
        <PageHeader title="New chat" />
        <EmptyState
          icon={FolderKanban}
          title="No project selected"
          description="Select or create a project before starting a chat."
          action={<Button onClick={() => navigate("/projects")}>Go to projects</Button>}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-lg">
      <PageHeader
        eyebrow={activeProject?.name}
        title="New chat"
        description="Start a conversation. A default branch will be created for it."
      />

      <Card>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-name" className={labelClass}>
              Chat name
            </Label>
            <Input
              id="chat-name"
              autoFocus
              placeholder="e.g. Auth implementation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className={labelClass}>Model</Label>
            {modelList.length === 0 ? (
              <Button variant="outline" onClick={() => navigate("/settings/models")}>
                Configure a provider
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                {Object.entries(models).map(([provider, ids]) => (
                  <div key={provider} className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">{provider}</span>
                    <div className="flex flex-col gap-1.5">
                      {ids.map((id) => {
                        const selected = model === id;
                        return (
                          <button
                            type="button"
                            key={id}
                            onClick={() => setModel(id)}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                              selected
                                ? "border-ring/60 bg-muted/50"
                                : "border-border hover:bg-muted/60",
                            )}
                          >
                            <span className="font-code-sm text-foreground">{id}</span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!model || submitting}>
              <MessageSquarePlus className="h-4 w-4" />
              Create chat
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/40 p-3">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-highlight" />
        <p className="text-xs text-muted-foreground">
          Each chat starts on a <strong className="font-medium text-foreground">main branch</strong>. You can fork
          branches later to explore alternatives while keeping shared context.
        </p>
      </div>
    </PageContainer>
  );
}
