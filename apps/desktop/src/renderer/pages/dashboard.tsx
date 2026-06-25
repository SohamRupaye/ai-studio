import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, Plus, ArrowRight } from "lucide-react";
import { PageContainer, EmptyState } from "../components/page-primitives";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Heading, Text } from "../components/ui/typography";
import { useWorkspace } from "../components/workspace-provider";
import { useAuth } from "../components/auth-provider";
import {
  useChats,
  useBranches,
  useArtifacts,
  useProjectCosts,
} from "../hooks/use-ipc-data";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeProject, activeProjectId } = useWorkspace();

  const { data: chats = [] } = useChats(activeProjectId);
  const { data: allBranches = [] } = useBranches();
  const { data: artifacts = [] } = useArtifacts(activeProjectId);
  const { data: costs } = useProjectCosts(activeProjectId);

  const chatIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  const chatNameById = useMemo(() => new Map(chats.map((c) => [c.id, c.name])), [chats]);
  const projectBranches = useMemo(
    () => allBranches.filter((b) => b.chatId && chatIds.has(b.chatId)),
    [allBranches, chatIds],
  );

  const recentBranches = useMemo(
    () => [...projectBranches].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [projectBranches],
  );

  return (
    <PageContainer className="stagger-children my-auto">
      {/* Hero greeting */}
      <div className="mb-7 text-center">
        <Text size="sm" variant="muted" as="div" className="mb-1.5">
          {activeProject?.name ?? "No project"}
        </Text>
        <h1 className="font-h1">
          {greeting()}, {user?.name?.split(" ")[0] ?? "there"}
        </h1>
      </div>

      {/* Launcher — the one glowing thing on this screen */}
      <div className="mx-auto w-full max-w-xl">
        <button
          onClick={() => navigate("/chat/new")}
          className="glow-hero hover:glow-hero-strong pressable group flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all duration-300 hover:border-ring/40"
        >
          <Plus className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-hover:rotate-90" />
          <span className="flex-1 text-[15px] text-muted-foreground/60">Start a new chat…</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>

        {/* Workspace pulse — one quiet line, not four cards */}
        <div className="mt-4 text-center text-xs text-muted-foreground/60">
          {chats.length} {chats.length === 1 ? "chat" : "chats"} ·{" "}
          {projectBranches.length} {projectBranches.length === 1 ? "branch" : "branches"} ·{" "}
          {artifacts.length} {artifacts.length === 1 ? "artifact" : "artifacts"} · $
          {(costs?.totalCost ?? 0).toFixed(2)} spent
        </div>
      </div>

      {/* Jump back in */}
      <div className="mx-auto mt-14 w-full max-w-xl">
        <div className="mb-3 flex items-center justify-between">
          <Heading size="h4" as="div">
            Jump back in
          </Heading>
          {projectBranches.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/branches/compare")}>
              Compare branches
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {recentBranches.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="Nothing here yet"
            description="Your chats and branches will show up here as you work."
          />
        ) : (
          <Card className="divide-y divide-border/70 overflow-hidden">
            {recentBranches.map((branch) => (
              <button
                key={branch.id}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                onClick={() => navigate(`/chat/${branch.id}`)}
              >
                <GitBranch className="h-4 w-4 shrink-0 text-highlight" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    <span className="font-medium">
                      {chatNameById.get(branch.chatId ?? "") ?? "Chat"}
                    </span>
                    <span className="text-muted-foreground"> / {branch.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground/70">
                    {new Date(branch.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <Badge variant="secondary" className="font-code-sm shrink-0">
                  {branch.model}
                </Badge>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground/70" />
              </button>
            ))}
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
