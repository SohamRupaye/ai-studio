import { useState, useEffect } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Search,
  Network,
  Settings,
  ChevronRight,
  Brain,
  FileText,
  MessageSquare,
  GitBranch,
  Plus,
  LayoutDashboard,
  Check,
  ChevronsUpDown,
  DollarSign,
  GitCompare,
  BookOpen,
} from "lucide-react";
import type { Chat, Branch } from "@ai-studio/shared";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace-provider";
import { useAuth } from "./auth-provider";
import { useChats, useBranches } from "../hooks/use-ipc-data";

// ─────────────────────────────────────────────────────────────────────────────
// Primary navigation links (top-level destinations)
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { to: "/artifacts", label: "Artifacts", icon: FileText },
  { to: "/graph", label: "Knowledge Graph", icon: Network },
];

const FOOTER_NAV = [
  { to: "/branches/compare", label: "Compare branches", icon: GitCompare },
  { to: "/settings/costs", label: "Cost tracker", icon: DollarSign },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");

  const initials = (user?.name ?? "User")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");

  return (
    <aside className="flex w-[264px] shrink-0 flex-col bg-sidebar">
      {/* Workspace switcher — org + project in one control */}
      <div className="px-3 pb-1">
        <WorkspaceSwitcher />
      </div>

      {/* Search */}
      <div className="px-3 pb-2 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="h-8 w-full rounded-lg bg-black/[0.045] pl-8 pr-11 text-[13px] text-sidebar-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:bg-white/[0.06] dark:focus:bg-white/[0.09]"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground/60">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="space-y-px px-3">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      {/* Chats + branches tree */}
      <ScrollArea className="flex-1 px-3 pb-2 pt-3">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="font-label-sm text-muted-foreground/80">Chats</span>
          <button
            onClick={() => navigate("/chat/new")}
            className="pressable rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <ChatTree />
      </ScrollArea>

      {/* Footer nav */}
      <div className="space-y-px px-3 pb-1 pt-2">
        {FOOTER_NAV.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </div>

      {/* User */}
      <div className="mx-3 mb-2 mt-1 flex items-center gap-2.5 rounded-lg px-2 py-2">
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="truncate text-[13px] font-medium text-sidebar-foreground">
          {user?.name ?? "User"}
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SidebarLink — neutral pill, no accent tinting; icons stay quiet
// ─────────────────────────────────────────────────────────────────────────────

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "pressable flex items-center gap-2.5 rounded-lg px-2 py-[6px] text-[13px] transition-colors",
          isActive
            ? "bg-sidebar-accent font-medium text-foreground"
            : "font-normal text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "h-4 w-4",
              isActive ? "text-foreground" : "text-muted-foreground/80",
            )}
          />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkspaceSwitcher — one control for the org → project context.
// Org reads as the eyebrow, project as the primary line; the popover lists
// both levels so switching context is a single interaction.
// ─────────────────────────────────────────────────────────────────────────────

function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const {
    orgs,
    projects,
    activeOrg,
    activeProject,
    setActiveOrgId,
    setActiveProjectId,
  } = useWorkspace();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="pressable flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60"
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white shadow-sm"
          style={{ background: "linear-gradient(135deg, hsl(var(--iris-500)), hsl(var(--iris-700)))" }}
        >
          {(activeOrg?.name ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            {activeOrg?.name ?? "No organisation"}
          </div>
          <div className="truncate text-[13px] font-semibold leading-snug text-sidebar-foreground">
            {activeProject?.name ?? "Select project"}
          </div>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="animate-pop absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
            <SwitcherGroup label="Organisation">
              {orgs.length === 0 && <SwitcherEmpty>No organisations</SwitcherEmpty>}
              {orgs.map((org) => (
                <SwitcherItem
                  key={org.id}
                  name={org.name}
                  selected={activeOrg?.id === org.id}
                  onClick={() => setActiveOrgId(org.id)}
                />
              ))}
              <SwitcherCreate
                label="New organisation"
                onClick={() => {
                  navigate("/orgs");
                  setOpen(false);
                }}
              />
            </SwitcherGroup>

            <div className="my-1 h-px bg-border" />

            <SwitcherGroup label="Project">
              {projects.length === 0 && <SwitcherEmpty>No projects yet</SwitcherEmpty>}
              {projects.map((project) => (
                <SwitcherItem
                  key={project.id}
                  name={project.name}
                  selected={activeProject?.id === project.id}
                  onClick={() => {
                    setActiveProjectId(project.id);
                    setOpen(false);
                  }}
                />
              ))}
              <SwitcherCreate
                label="New project"
                onClick={() => {
                  navigate("/projects");
                  setOpen(false);
                }}
              />
            </SwitcherGroup>
          </div>
        </>
      )}
    </div>
  );
}

function SwitcherGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-label-sm px-2 pb-1 pt-1.5 text-muted-foreground/70">{label}</div>
      {children}
    </div>
  );
}

function SwitcherItem({
  name,
  selected,
  onClick,
}: {
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
    >
      <span className={cn("flex-1 truncate", selected && "font-medium")}>{name}</span>
      {selected && <Check className="h-3.5 w-3.5 text-primary" />}
    </button>
  );
}

function SwitcherCreate({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Plus className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function SwitcherEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatTree — chats for the active project, expandable to show branches
// ─────────────────────────────────────────────────────────────────────────────

function ChatTree() {
  const { activeProjectId } = useWorkspace();
  const { data: chats = [], loading } = useChats(activeProjectId);
  const { branchId } = useParams();

  if (!activeProjectId) {
    return <TreeHint>Select a project to see its chats</TreeHint>;
  }

  if (loading) {
    return <TreeHint>Loading…</TreeHint>;
  }

  if (chats.length === 0) {
    return <TreeHint>No chats yet</TreeHint>;
  }

  return (
    <div className="space-y-px">
      {chats.map((chat) => (
        <ChatTreeItem key={chat.id} chat={chat} activeBranchId={branchId} />
      ))}
    </div>
  );
}

function TreeHint({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-[12px] text-muted-foreground/70">{children}</p>;
}

function ChatTreeItem({ chat, activeBranchId }: { chat: Chat; activeBranchId?: string }) {
  const { data: allBranches = [] } = useBranches();
  const branches = allBranches.filter((b) => b.chatId === chat.id);
  const containsActive = !!activeBranchId && branches.some((b) => b.id === activeBranchId);
  const [expanded, setExpanded] = useState(containsActive);

  // Auto-expand when the active branch belongs to this chat (e.g. after New Chat).
  useEffect(() => {
    if (containsActive) setExpanded(true);
  }, [containsActive]);

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-lg py-[5px] pl-1.5 pr-2 text-[13px] transition-colors",
          containsActive
            ? "text-sidebar-foreground"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
        <span className="truncate">{chat.name}</span>
        {branches.length > 0 && (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/60">
            {branches.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="ml-[13px] mt-px space-y-px border-l border-sidebar-border pl-1.5">
          {branches.length === 0 && <TreeHint>No branches</TreeHint>}
          <BranchTree branches={branches} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BranchTree — renders branches nested by parentId so forks indent under
// the branch they were created from.
// ─────────────────────────────────────────────────────────────────────────────

function BranchTree({ branches }: { branches: Branch[] }) {
  const ids = new Set(branches.map((b) => b.id));
  // Roots: branches with no parent, or whose parent isn't in this chat.
  const roots = branches.filter((b) => !b.parentId || !ids.has(b.parentId));
  return (
    <>
      {roots.map((b) => (
        <BranchNode key={b.id} branch={b} branches={branches} depth={0} />
      ))}
    </>
  );
}

function BranchNode({
  branch,
  branches,
  depth,
}: {
  branch: Branch;
  branches: Branch[];
  depth: number;
}) {
  const children = branches.filter((b) => b.parentId === branch.id);
  return (
    <div>
      <BranchLink branch={branch} depth={depth} />
      {children.map((c) => (
        <BranchNode key={c.id} branch={c} branches={branches} depth={depth + 1} />
      ))}
    </div>
  );
}

function BranchLink({ branch, depth }: { branch: Branch; depth: number }) {
  return (
    <NavLink
      to={`/chat/${branch.id}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-lg py-[5px] pr-2 text-[13px] transition-colors",
          isActive
            ? "bg-sidebar-accent font-medium text-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <GitBranch
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isActive ? "text-highlight" : "text-muted-foreground/60",
            )}
          />
          <span className="truncate">{branch.name}</span>
        </>
      )}
    </NavLink>
  );
}
