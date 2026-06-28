import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PanelRight, GitBranch, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace-provider";
import { useUiPrefs } from "./ui-prefs";
import { useBranches, invalidateQueries } from "../hooks/use-ipc-data";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Route → breadcrumb label map
// ─────────────────────────────────────────────────────────────────────────────

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/memory": "Memory",
  "/artifacts": "Artifacts",
  "/graph": "Knowledge Graph",
  "/branches/compare": "Compare Branches",
  "/settings": "Settings",
  "/settings/models": "Model Settings",
  "/settings/costs": "Cost Tracker",
  "/orgs": "Organizations",
  "/projects": "Projects",
  "/chat/new": "New Chat",
};

export function TitleBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { branchId } = useParams();
  const { activeProject } = useWorkspace();
  const { toggleRightPanel } = useUiPrefs();
  const { data: branches = [] } = useBranches();

  const activeBranch = branchId ? branches.find((b) => b.id === branchId) : undefined;

  // Fork the current branch: a new branch under the SAME chat, parented at the
  // current branch's latest turn. This is distinct from "New Chat".
  const forkBranch = async () => {
    if (!activeBranch) return;
    try {
      const msgs = await window.ipc.invoke("message:list", { branchId: activeBranch.id });
      const siblingCount = branches.filter((b) => b.chatId === activeBranch.chatId).length;
      const branch = await window.ipc.invoke("branch:create", {
        name: `branch-${siblingCount}`,
        model: activeBranch.model,
        chatId: activeBranch.chatId,
        parentId: activeBranch.id,
        forkAtIndex: msgs.length,
      });
      invalidateQueries();
      toast.success(`Forked "${branch.name}" from ${activeBranch.name}`);
      navigate(`/chat/${branch.id}`);
    } catch (err) {
      toast.error(`Could not create branch: ${(err as Error).message}`);
    }
  };

  // Build breadcrumb segments
  const segments: string[] = [];
  if (activeProject) segments.push(activeProject.name);

  const staticTitle = TITLES[location.pathname];
  if (activeBranch) {
    segments.push("Chat");
    segments.push(activeBranch.name);
  } else if (staticTitle) {
    segments.push(staticTitle);
  }

  return (
    <header className="drag-region flex h-12 shrink-0 items-center justify-between bg-background px-4">
      {/* macOS traffic-lights spacer */}
      <div className="w-16" />

      {/* Breadcrumb */}
      <div className="no-drag flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/40">/</span>}
            <span className={i === segments.length - 1 ? "font-medium text-foreground" : ""}>
              {seg}
            </span>
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="no-drag flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => navigate("/chat/new")}>
          <Plus className="h-4 w-4" />
          New chat
        </Button>
        {activeBranch && (
          <>
            <Button variant="ghost" size="sm" onClick={forkBranch}>
              <GitBranch className="h-4 w-4" />
              Fork
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleRightPanel}
              title="Toggle context panel"
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
