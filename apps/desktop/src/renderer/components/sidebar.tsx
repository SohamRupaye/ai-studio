import { useState } from "react";
import {
  Search,
  Network,
  Settings,
  FolderOpen,
  ChevronRight,
  Brain,
  FileText,
  MessageSquare,
  GitBranch,
  Sparkles,
  Layers,
} from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";

interface FolderData {
  id: string;
  name: string;
  color: string;
  memories: { id: string; label: string }[];
  artifacts: { id: string; label: string }[];
  chats: { id: string; label: string; branches?: { id: string; label: string; color: string }[] }[];
}

const DUMMY_FOLDERS: FolderData[] = [
  {
    id: "design",
    name: "Design",
    color: "#ef4444",
    memories: [
      { id: "m1", label: "Brand guidelines context" },
      { id: "m2", label: "Color palette notes" },
    ],
    artifacts: [
      { id: "a1", label: "Component library spec" },
      { id: "a2", label: "Figma export tokens" },
    ],
    chats: [
      {
        id: "c1",
        label: "UI exploration",
        branches: [
          { id: "b1", label: "Main branch", color: "#f59e0b" },
          { id: "b2", label: "Dark mode variant", color: "#8b5cf6" },
        ],
      },
      { id: "c2", label: "Icon set discussion" },
    ],
  },
  {
    id: "development",
    name: "Development",
    color: "#f59e0b",
    memories: [
      { id: "m3", label: "API architecture decisions" },
      { id: "m4", label: "Tech stack preferences" },
      { id: "m5", label: "Performance benchmarks" },
    ],
    artifacts: [
      { id: "a3", label: "Database schema v2" },
      { id: "a4", label: "REST API documentation" },
      { id: "a5", label: "Deployment runbook" },
    ],
    chats: [
      {
        id: "c3",
        label: "Auth implementation",
        branches: [
          { id: "b3", label: "Main branch", color: "#f59e0b" },
          { id: "b4", label: "OAuth flow", color: "#3b82f6" },
          { id: "b5", label: "JWT refresh", color: "#ef4444" },
        ],
      },
    ],
  },
  {
    id: "research",
    name: "Research",
    color: "#8b5cf6",
    memories: [{ id: "m6", label: "Competitor analysis" }],
    artifacts: [{ id: "a6", label: "Market report Q4" }],
    chats: [
      { id: "c4", label: "LLM comparison" },
      { id: "c5", label: "Pricing strategy" },
    ],
  },
];

export function Sidebar() {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["development"]));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["development-chats"]));
  const [activeItem, setActiveItem] = useState("b3");
  const [searchQuery, setSearchQuery] = useState("");

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex w-[270px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[15px] font-semibold text-sidebar-foreground">Organisation</span>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-border" />
      </div>

      {/* macOS Liquid Glass Search Bar */}
      <div className="px-3 py-2">
        <div className="glass-searchbar relative rounded-[10px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full h-[36px] rounded-[10px] pl-9 pr-12 text-[13px] bg-transparent text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] bg-black/[0.05] dark:bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-muted-foreground font-medium">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Workspace */}
      <div className="px-4 py-1">
        <div className="flex items-center gap-2.5 py-1.5 text-[13px] font-medium text-sidebar-foreground">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>Workspace name</span>
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 px-2 pb-2">
        <div className="space-y-0.5">
          {DUMMY_FOLDERS.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              isExpanded={expandedFolders.has(folder.id)}
              expandedSections={expandedSections}
              activeItem={activeItem}
              onToggleFolder={() => toggleFolder(folder.id)}
              onToggleSection={toggleSection}
              onSelectItem={setActiveItem}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-2 py-2 space-y-0.5">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 text-[13px] h-8 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent">
          <Network className="h-4 w-4" /> Project graph
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 text-[13px] h-8 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent">
          <Settings className="h-4 w-4" /> Project settings
        </Button>
      </div>

      {/* User */}
      <div className="border-t border-sidebar-border flex items-center gap-3 px-4 py-3">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[12px] font-semibold text-white shadow-sm">
          S
        </div>
        <span className="text-[13px] font-medium text-sidebar-foreground">Soham Rupaye</span>
      </div>
    </aside>
  );
}

function FolderItem({
  folder,
  isExpanded,
  expandedSections,
  activeItem,
  onToggleFolder,
  onToggleSection,
  onSelectItem,
}: {
  folder: FolderData;
  isExpanded: boolean;
  expandedSections: Set<string>;
  activeItem: string;
  onToggleFolder: () => void;
  onToggleSection: (id: string) => void;
  onSelectItem: (id: string) => void;
}) {
  return (
    <div>
      <button
        onClick={onToggleFolder}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-sidebar-foreground hover:bg-accent transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <div className="h-3 w-3 rounded-[4px]" style={{ backgroundColor: folder.color }} />
        <span>{folder.name}</span>
      </button>

      {isExpanded && (
        <div className="ml-4 border-l border-sidebar-border pl-2 mt-0.5 space-y-0.5">
          <SectionItem
            icon={<Brain className="h-4 w-4 text-violet-500" />}
            label="Memories"
            items={folder.memories}
            isExpanded={expandedSections.has(`${folder.id}-memories`)}
            activeItem={activeItem}
            onToggle={() => onToggleSection(`${folder.id}-memories`)}
            onSelectItem={onSelectItem}
            itemIcon={<Sparkles className="h-3.5 w-3.5 text-violet-400" />}
          />
          <SectionItem
            icon={<Layers className="h-4 w-4 text-emerald-500" />}
            label="Artifacts"
            items={folder.artifacts}
            isExpanded={expandedSections.has(`${folder.id}-artifacts`)}
            activeItem={activeItem}
            onToggle={() => onToggleSection(`${folder.id}-artifacts`)}
            onSelectItem={onSelectItem}
            itemIcon={<FileText className="h-3.5 w-3.5 text-emerald-400" />}
          />
          <ChatSection
            folderId={folder.id}
            chats={folder.chats}
            isExpanded={expandedSections.has(`${folder.id}-chats`)}
            expandedSections={expandedSections}
            activeItem={activeItem}
            onToggle={() => onToggleSection(`${folder.id}-chats`)}
            onToggleSection={onToggleSection}
            onSelectItem={onSelectItem}
          />
        </div>
      )}
    </div>
  );
}

function SectionItem({
  icon,
  label,
  items,
  isExpanded,
  activeItem,
  onToggle,
  onSelectItem,
  itemIcon,
}: {
  icon: React.ReactNode;
  label: string;
  items: { id: string; label: string }[];
  isExpanded: boolean;
  activeItem: string;
  onToggle: () => void;
  onSelectItem: (id: string) => void;
  itemIcon: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] text-sidebar-foreground/80 hover:bg-accent transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{items.length}</span>
      </button>
      {isExpanded && (
        <div className="ml-5 space-y-0.5 mt-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectItem(item.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] transition-colors",
                activeItem === item.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-sidebar-foreground/70 hover:bg-accent hover:text-sidebar-foreground"
              )}
            >
              {itemIcon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatSection({
  folderId,
  chats,
  isExpanded,
  expandedSections,
  activeItem,
  onToggle,
  onToggleSection,
  onSelectItem,
}: {
  folderId: string;
  chats: FolderData["chats"];
  isExpanded: boolean;
  expandedSections: Set<string>;
  activeItem: string;
  onToggle: () => void;
  onToggleSection: (id: string) => void;
  onSelectItem: (id: string) => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] text-sidebar-foreground/80 hover:bg-accent transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <MessageSquare className="h-4 w-4 text-blue-500" />
        <span>Chats</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{chats.length}</span>
      </button>
      {isExpanded && (
        <div className="ml-5 space-y-0.5 mt-0.5">
          {chats.map((chat) => (
            <div key={chat.id}>
              {chat.branches ? (
                <>
                  <button
                    onClick={() => onToggleSection(`${folderId}-chat-${chat.id}`)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] text-sidebar-foreground/70 hover:bg-accent transition-colors"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 text-muted-foreground transition-transform duration-200",
                        expandedSections.has(`${folderId}-chat-${chat.id}`) && "rotate-90"
                      )}
                    />
                    <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                    <span className="truncate">{chat.label}</span>
                  </button>
                  {expandedSections.has(`${folderId}-chat-${chat.id}`) && (
                    <div className="ml-6 space-y-0.5 mt-0.5">
                      {chat.branches.map((branch) => (
                        <button
                          key={branch.id}
                          onClick={() => onSelectItem(branch.id)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] transition-colors",
                            activeItem === branch.id
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-sidebar-foreground/70 hover:bg-accent hover:text-sidebar-foreground"
                          )}
                        >
                          <GitBranch className="h-3.5 w-3.5" style={{ color: branch.color }} />
                          <span className="truncate">{branch.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => onSelectItem(chat.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] transition-colors",
                    activeItem === chat.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-sidebar-foreground/70 hover:bg-accent hover:text-sidebar-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                  <span className="truncate">{chat.label}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
