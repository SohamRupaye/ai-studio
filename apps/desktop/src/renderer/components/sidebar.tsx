import { Search, Network, Settings, FolderOpen, MessageSquare, Brain, FileText, GitBranch } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold text-sidebar-foreground">Organisation</span>
        <div className="flex items-center gap-1">
          <img src="" alt="" className="h-8 w-8 rounded-md bg-muted" />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search..." className="h-8 pl-8 text-xs" />
          <kbd className="absolute right-2 top-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
        </div>
      </div>

      {/* Workspace tree */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 py-1">
          {/* Workspace name */}
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-foreground">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Workspace name
          </div>

          {/* Teams/Folders */}
          <TreeItem icon={<div className="h-3 w-3 rounded-sm bg-red-400" />} label="Design" indent={1} />
          <TreeItem icon={<div className="h-3 w-3 rounded-sm bg-amber-400" />} label="Development" indent={1} />

          {/* Sections */}
          <TreeItem icon={<Brain className="h-3.5 w-3.5" />} label="Memories" indent={2} />
          <TreeItem icon={<FileText className="h-3.5 w-3.5" />} label="Artifacts" indent={2} />

          {/* Chats */}
          <TreeItem icon={<MessageSquare className="h-3.5 w-3.5" />} label="Chats" indent={2} />
          <TreeItem icon={<GitBranch className="h-3.5 w-3.5 text-amber-500" />} label="Main branch" indent={3} active />
          <TreeItem icon={<GitBranch className="h-3.5 w-3.5 text-red-400" />} label="Branch 1" indent={3} />
          <TreeItem icon={<GitBranch className="h-3.5 w-3.5 text-blue-400" />} label="Branch 2" indent={3} />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs">
          <Network className="h-3.5 w-3.5" /> Project graph
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs">
          <Settings className="h-3.5 w-3.5" /> Project settings
        </Button>
      </div>

      {/* User */}
      <div className="border-t border-sidebar-border flex items-center gap-2 px-3 py-2">
        <div className="h-7 w-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-medium text-blue-600">S</div>
        <span className="text-xs font-medium text-sidebar-foreground">Soham Rupaye</span>
      </div>
    </aside>
  );
}

function TreeItem({ icon, label, indent = 0, active = false }: { icon: React.ReactNode; label: string; indent?: number; active?: boolean }) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent ${active ? "bg-accent font-medium" : "text-sidebar-foreground"}`}
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
    >
      {icon}
      {label}
    </button>
  );
}
