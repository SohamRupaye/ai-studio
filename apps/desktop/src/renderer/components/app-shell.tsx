import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ChatCircleIcon, GearIcon } from "@phosphor-icons/react";
import { cn } from "../lib/utils";
import { useUiPrefs } from "./ui-prefs";
import { useWorkspace } from "./workspace-provider";
import { useChats } from "../hooks/use-ipc-data";
import { Sidebar, PRIMARY_NAV, FOOTER_NAV } from "./sidebar";
import { ProjectRail } from "./project-rail";
import { Topbar } from "./topbar";
import { TooltipProvider } from "./ui/tooltip";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";

// ─────────────────────────────────────────────────────────────────────────────
// App shell — fixed topbar over [project rail | sidebar | page card].
// Chrome sits on the bare canvas; the page card is the raised surface.
// ─────────────────────────────────────────────────────────────────────────────

export function AppShell() {
  const [commandOpen, setCommandOpen] = useState(false);
  const { sidebarOpen, toggleSidebar } = useUiPrefs();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <TooltipProvider delay={400}>
      <div className="flex h-dvh flex-col bg-canvas">
        <Topbar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <div className="flex min-h-0 flex-1">
          {/* Rail + sidebar collapse together; fixed inner width so text
              doesn't reflow while the wrapper animates shut. */}
          <div
            className={cn(
              "flex shrink-0 overflow-hidden transition-[width] duration-200 ease-(--ease-standard)",
              sidebarOpen ? "w-[320px]" : "w-0",
            )}
          >
            <ProjectRail />
            <Sidebar onOpenCommandBar={() => setCommandOpen(true)} />
          </div>
          <main className="relative mx-2 mb-2 min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface-1 shadow-raised">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandBar open={commandOpen} onOpenChange={setCommandOpen} />
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⌘K command bar — chats + destinations, sharing the sidebar's nav model.
// ─────────────────────────────────────────────────────────────────────────────

function CommandBar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { activeProjectId } = useWorkspace();
  const { data: chats } = useChats(activeProjectId);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search chats and pages…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Chats">
          {(chats ?? []).map((chat) => (
            <CommandItem key={chat.id} onSelect={() => go(`/chats/${chat.id}`)}>
              <ChatCircleIcon />
              {chat.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {[...PRIMARY_NAV, ...FOOTER_NAV].map((item) => (
            <CommandItem key={item.to} onSelect={() => go(item.to)}>
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
          <CommandItem onSelect={() => go("/settings")}>
            <GearIcon />
            Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
