import { useMemo } from "react";
import { Link, matchPath, useLocation } from "react-router-dom";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Branch } from "@squirl/shared";
import { cn, modelLabel, providerLogoKey } from "../lib/utils";
import { useUiPrefs } from "./ui-prefs";
import { useWorkspace } from "./workspace-provider";
import {
  useBranches,
  useChats,
  useIsFullscreen,
  useModels,
  useMutation,
  useSpaces,
} from "../hooks/use-ipc-data";
import { Combobox, type ComboboxItem } from "./ui/combobox";
import { hasProviderLogo, ProviderTile } from "./provider-logos";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// ─────────────────────────────────────────────────────────────────────────────
// Topbar — fixed window chrome. The left zone mirrors the sidebar column's
// width so the breadcrumb starts over the page card, Notion-style; collapse
// the sidebar and the breadcrumb slides left to sit beside the hamburger.
// ─────────────────────────────────────────────────────────────────────────────

interface Crumb {
  label: string;
  to?: string;
  mono?: boolean;
}

const STATIC_LABELS: Record<string, string> = {
  "/": "Home",
  "/knowledge-base": "Knowledge base",
  "/graph": "Knowledge graph",
  "/branches/compare": "Compare branches",
  "/costs": "Costs",
  "/settings": "Settings",
};

export function Topbar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const { pathname } = useLocation();
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: spaces } = useSpaces(activeProjectId);
  const { data: chats } = useChats(activeProjectId);
  const { data: branches } = useBranches();
  const { data: modelCatalogue } = useModels();
  const updateModel = useMutation("branch:update-model");
  const fullscreen = useIsFullscreen();
  const { rightPanelOpen, toggleRightPanel } = useUiPrefs();

  const crumbs: Crumb[] = [];
  if (activeProject) crumbs.push({ label: activeProject.name, to: "/" });

  const chatMatch =
    matchPath("/chats/:chatId/branches/:branchId", pathname) ??
    matchPath("/chats/:chatId", pathname);
  const spaceMatch = matchPath("/spaces/:spaceId/:section", pathname);

  // Resolved when on a branch page — drives the model switcher on the right.
  let branch: Branch | undefined;

  if (chatMatch) {
    const chat = chats?.find((c) => c.id === chatMatch.params.chatId);
    const space = spaces?.find((s) => s.id === chat?.spaceId);
    if (space) crumbs.push({ label: space.name });
    if (chat) crumbs.push({ label: chat.name });
    const branchId = (chatMatch.params as { branchId?: string }).branchId;
    branch = branches?.find((b) => b.id === branchId);
    if (branch) crumbs.push({ label: branch.name, mono: true });
  } else if (spaceMatch) {
    const space = spaces?.find((s) => s.id === spaceMatch.params.spaceId);
    if (space) crumbs.push({ label: space.name });
    const section = spaceMatch.params.section;
    if (section) crumbs.push({ label: section === "memories" ? "Memories" : "Artifacts" });
  } else if (STATIC_LABELS[pathname] && pathname !== "/") {
    crumbs.push({ label: STATIC_LABELS[pathname] });
  }

  // Grouped by provider (the catalogue's own key order) with a small mono
  // mark per entry — reused from the Settings provider work.
  const modelItems = useMemo(() => {
    const items: ComboboxItem[] = [];
    const seen = new Set<string>();
    for (const [entry, ids] of Object.entries(modelCatalogue ?? {})) {
      const logoKey = providerLogoKey(entry);
      const icon = hasProviderLogo(logoKey) ? (
        <ProviderTile
          provider={logoKey}
          monogram={entry.slice(0, 1).toUpperCase()}
          active={false}
          className="size-4 shrink-0 rounded-sm border-none bg-transparent p-0 shadow-none text-fg-subtle"
        />
      ) : undefined;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        // The value stays the full namespaced id (that's the routing key); only
        // the display is split, so a long namespace can't crowd out the name.
        items.push({ value: id, ...modelLabel(id), icon });
      }
    }
    return items;
  }, [modelCatalogue]);

  return (
    <header className="flex h-11 shrink-0 items-center [-webkit-app-region:drag]">
      {/* Left zone: traffic lights + hamburger. Width tracks the sidebar
          column so the breadcrumb lines up with the page card. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center overflow-hidden",
          "transition-[width] duration-200 ease-(--ease-standard)",
          // macOS hides the traffic lights in fullscreen — drop their gap.
          fullscreen ? "pl-3" : "pl-[76px]",
          sidebarOpen ? "w-[320px]" : fullscreen ? "w-[52px]" : "w-[116px]",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Toggle sidebar"
                onClick={onToggleSidebar}
                className="pressable flex size-7 items-center justify-center rounded-md text-fg-muted [-webkit-app-region:no-drag] hover:bg-surface-1 hover:text-fg"
              >
                <SidebarSimpleIcon size={16} />
              </button>
            }
          />
          <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex min-w-0 flex-1 items-center gap-1.5 px-4 text-label-md">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const label = (
            <span
              className={cn(
                "truncate",
                crumb.mono && "font-mono text-[12px]",
                last ? "text-fg" : "text-fg-muted",
              )}
            >
              {crumb.label}
            </span>
          );
          return (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="shrink-0 text-fg-subtle">/</span>}
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  className="min-w-0 rounded-sm px-1 py-0.5 [-webkit-app-region:no-drag] hover:bg-surface-1"
                >
                  {label}
                </Link>
              ) : (
                label
              )}
            </span>
          );
        })}
      </nav>

      {branch && modelItems.length > 0 && (
        <div className="shrink-0 pr-1.5 [-webkit-app-region:no-drag]">
          <Combobox
            items={modelItems}
            value={branch.model}
            onValueChange={(value) => {
              if (value && branch && value !== branch.model) {
                updateModel
                  .mutate({ id: branch.id, model: value })
                  .catch(() => toast.error("Couldn't switch models"));
              }
            }}
            align="end"
            className="h-7 min-w-0 max-w-56 rounded-md border-none bg-transparent px-2 font-mono text-[12px] shadow-none hover:bg-surface-1 hover:text-fg data-[popup-open]:bg-surface-1 data-[popup-open]:text-fg"
          />
        </div>
      )}
      {branch && (
        <div className="shrink-0 pr-3 [-webkit-app-region:no-drag]">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Toggle context panel"
                  aria-pressed={rightPanelOpen}
                  onClick={toggleRightPanel}
                  className={cn(
                    "pressable flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-1 hover:text-fg",
                    rightPanelOpen && "text-fg",
                  )}
                >
                  {/* Mirrored sidebar glyph = the right-hand panel. */}
                  <SidebarSimpleIcon size={16} className="-scale-x-100" />
                </button>
              }
            />
            <TooltipContent side="bottom">Toggle context panel</TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  );
}
