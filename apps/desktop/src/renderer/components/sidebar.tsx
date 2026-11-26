import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  BrainIcon,
  CaretDownIcon,
  ChatCircleIcon,
  CheckIcon,
  CoinsIcon,
  CubeIcon,
  ExportIcon,
  FileMdIcon,
  GearIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitForkIcon,
  GraphIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { Branch, Chat, Space } from "@squirl/shared";
import { cn, counted } from "../lib/utils";
import { useAuth } from "./auth-provider";
import { useWorkspace } from "./workspace-provider";
import { useBranches, useChats, useMutation, useSpaces } from "../hooks/use-ipc-data";
import { NameDialog } from "./name-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { KbdGroup } from "./ui/kbd";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// ─────────────────────────────────────────────────────────────────────────────
// Navigation model — shared with the command bar (app-shell.tsx).
// Project-wide destinations only; memories/artifacts/chats live inside spaces.
// ─────────────────────────────────────────────────────────────────────────────

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: HouseIcon, end: true },
  { to: "/knowledge-base", label: "Knowledge base", icon: NoteIcon },
  { to: "/graph", label: "Knowledge graph", icon: GraphIcon },
];

export const FOOTER_NAV: NavItem[] = [
  { to: "/branches/compare", label: "Compare branches", icon: GitDiffIcon },
  { to: "/costs", label: "Costs", icon: CoinsIcon },
];

// Shared row treatment: quiet at rest, up the elevation ramp when active.
const rowClasses = (isActive: boolean) =>
  cn(
    "pressable flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-label-md",
    isActive
      ? "bg-surface-2 text-fg shadow-raised"
      : "text-fg-muted hover:bg-surface-1 hover:text-fg",
  );

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — org header, raised search, trimmed nav, spaces tree, user row.
// Sits on the bare canvas; the page card to the right is the raised surface.
// ─────────────────────────────────────────────────────────────────────────────

export function Sidebar({ onOpenCommandBar }: { onOpenCommandBar: () => void }) {
  const { user } = useAuth();

  const initials = (user?.name ?? "User")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col">
      <div className="px-3">
        <WorkspaceHeader />
      </div>

      <div className="px-3 pb-1 pt-2">
        <button
          type="button"
          onClick={onOpenCommandBar}
          className="pressable flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-label-md text-fg-subtle shadow-raised hover:border-line-strong hover:bg-surface-3 hover:text-fg-muted"
        >
          <MagnifyingGlassIcon size={14} />
          <span>Search</span>
          <KbdGroup keys={["⌘", "K"]} className="ml-auto" />
        </button>
      </div>

      <nav className="space-y-1 px-3 pt-1">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>

      <SpacesTree />

      <div className="space-y-1 px-3 pt-2">
        {FOOTER_NAV.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </div>

      {/* User row — gear is the settings entry, so it needs no nav item. */}
      <div className="mx-3 mb-2 mt-1 flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <Avatar size="sm" fallback={initials} />
        <span className="min-w-0 flex-1 truncate text-label-md text-fg">
          {user?.name ?? "User"}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <NavLink
                to="/settings"
                aria-label="Settings"
                className={({ isActive }) =>
                  cn(
                    "pressable flex size-7 items-center justify-center rounded-md",
                    isActive
                      ? "bg-surface-2 text-fg shadow-raised"
                      : "text-fg-muted hover:bg-surface-3 hover:text-fg",
                  )
                }
              >
                <GearIcon size={16} />
              </NavLink>
            }
          />
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const { to, label, icon: IconComponent, end } = item;
  return (
    <NavLink to={to} end={end} className={({ isActive }) => rowClasses(isActive)}>
      {({ isActive }) => (
        <>
          <IconComponent
            size={16}
            weight={isActive ? "fill" : "regular"}
            className={cn("shrink-0", isActive ? "text-fg" : "text-fg-subtle")}
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace header — the project (what the rail switches) is the headline;
// the org is a quiet eyebrow above it, and the caret hugs its text.
// ─────────────────────────────────────────────────────────────────────────────

function WorkspaceHeader() {
  const { orgs, activeOrg, activeProject, setActiveOrgId } = useWorkspace();
  const createOrg = useMutation("org:create");
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col">
      <Menu>
        <MenuTrigger className="pressable inline-flex max-w-full items-center gap-1 self-start rounded-sm px-1 py-0.5 text-label-sm text-fg-subtle hover:bg-surface-1 hover:text-fg-muted data-[popup-open]:bg-surface-1">
          <span className="truncate">{activeOrg?.name ?? "No organisation"}</span>
          <CaretDownIcon size={10} weight="bold" className="shrink-0" />
        </MenuTrigger>
        <MenuContent className="w-56">
          {orgs.map((org) => (
            <MenuItem key={org.id} onClick={() => setActiveOrgId(org.id)}>
              <span className="truncate">{org.name}</span>
              {org.id === activeOrg?.id && <CheckIcon size={14} weight="bold" className="ml-auto" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => setCreating(true)}>
            <PlusIcon size={14} />
            New organisation
          </MenuItem>
        </MenuContent>
      </Menu>
      <h1 className="truncate px-1 text-heading-sm text-fg">
        {activeProject?.name ?? "No project"}
      </h1>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New organisation"
        placeholder="Organisation name"
        onSubmit={async (name) => {
          const org = await createOrg.mutate({ name });
          setActiveOrgId(org.id);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spaces tree: space ▸ (Memories · Artifacts · Chats ▸ chat ▸ branches).
// Chat rows are accordions, not links — you always land on a branch.
// ─────────────────────────────────────────────────────────────────────────────

function SpacesTree() {
  const { activeProjectId } = useWorkspace();
  const { data: spaces, loading, error, refetch } = useSpaces(activeProjectId);
  const { data: chats } = useChats(activeProjectId);
  const { data: branches } = useBranches();
  const createSpace = useMutation("space:create");
  const [creating, setCreating] = useState(false);

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between pb-1 pl-5 pr-3">
        <span className="text-label-sm text-fg-subtle">Spaces</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New space"
                onClick={() => setCreating(true)}
              >
                <PlusIcon size={14} />
              </Button>
            }
          />
          <TooltipContent>New space</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {loading ? (
          <div className="space-y-2 px-2 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : error ? (
          // An IPC failure is not an empty project — say so, and offer a retry.
          <div className="flex flex-col items-start gap-2 px-2 py-1">
            <p className="text-body-sm text-danger-text">Couldn&apos;t load spaces.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : !spaces || spaces.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-1">
            <p className="text-body-sm text-fg-subtle">No spaces in this project yet.</p>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <PlusIcon size={13} />
              New space
            </Button>
          </div>
        ) : (
          <div className="stagger-children space-y-0.5">
            {spaces.map((space) => (
              <SpaceItem
                key={space.id}
                space={space}
                chats={(chats ?? []).filter((c) => c.spaceId === space.id)}
                branches={branches ?? []}
              />
            ))}
          </div>
        )}
      </div>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New space"
        description="A functional area of the project — Design, Development, Business…"
        placeholder="Space name"
        onSubmit={async (name) => {
          if (!activeProjectId) return;
          await createSpace.mutate({ projectId: activeProjectId, name });
        }}
      />
    </div>
  );
}

function SpaceItem({
  space,
  chats,
  branches,
}: {
  space: Space;
  chats: Chat[];
  branches: Branch[];
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const createChat = useMutation("chat:create");
  const renameSpace = useMutation("space:rename");
  const deleteSpace = useMutation("space:delete");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [impact, setImpact] = useState<{
    chats: number;
    artifacts: number;
    memories: number;
  } | null>(null);

  // Count the contents before asking — the confirm should say what it costs.
  const openDeleteConfirm = async () => {
    try {
      setImpact(await window.ipc.invoke("space:impact", { id: space.id }));
    } catch {
      setImpact(null); // fall back to generic copy rather than blocking the dialog
    }
    setConfirmingDelete(true);
  };

  const impactSummary = impact
    ? `${counted(impact.artifacts, "artifact")}, ${counted(impact.memories, "memory", "memories")} and ${counted(impact.chats, "chat")}`
    : "everything in it";

  return (
    <Collapsible defaultOpen>
      <ContextMenu>
        {/* While this row's menu is open, hold the row in its hover state so
            it's obvious which space the menu belongs to. */}
        <ContextMenuTrigger className="group/space block w-full">
          <CollapsibleTrigger className="w-full min-w-0 rounded-md px-2 py-1.5 text-label-md text-fg hover:bg-surface-1 group-data-[popup-open]/space:bg-surface-1">
            <span className="truncate">{space.name}</span>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel className="max-w-52 truncate">{space.name}</ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <PencilSimpleIcon />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
            onClick={openDeleteConfirm}
          >
            <TrashIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsiblePanel>
        {/* Connector hairline carries the nesting, like a file tree. */}
        <div className="ml-3.5 space-y-0.5 border-l border-line pb-1.5 pl-1.5 pt-0.5">
          <NavLink to={`/spaces/${space.id}/memories`} className={({ isActive }) => rowClasses(isActive)}>
            {({ isActive }) => (
              <>
                <BrainIcon size={15} weight={isActive ? "fill" : "regular"} className="shrink-0 text-fg-subtle" />
                <span className="truncate">Memories</span>
              </>
            )}
          </NavLink>
          <NavLink to={`/spaces/${space.id}/artifacts`} className={({ isActive }) => rowClasses(isActive)}>
            {({ isActive }) => (
              <>
                <CubeIcon size={15} weight={isActive ? "fill" : "regular"} className="shrink-0 text-fg-subtle" />
                <span className="truncate">Artifacts</span>
              </>
            )}
          </NavLink>

          <Collapsible defaultOpen>
            <div className="group/chats flex items-center gap-0.5">
              <CollapsibleTrigger className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-label-md text-fg-muted hover:bg-surface-1 hover:text-fg">
                <ChatCircleIcon size={15} className="shrink-0 text-fg-subtle" />
                <span className="truncate">Chats</span>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`New chat in ${space.name}`}
                className="opacity-0 group-focus-within/chats:opacity-100 group-hover/chats:opacity-100"
                onClick={() => setNewChatOpen(true)}
              >
                <PlusIcon size={13} />
              </Button>
            </div>
            <CollapsiblePanel>
              <div className="ml-3.5 space-y-0.5 border-l border-line pb-1.5 pl-1.5 pt-0.5">
                {chats.length === 0 && (
                  <p className="px-2 py-1 text-body-sm text-fg-subtle">No chats yet</p>
                )}
                {chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    branches={branches.filter((b) => b.chatId === chat.id)}
                  />
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </CollapsiblePanel>

      <NameDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        title="New chat"
        description="Leave the name empty to auto-title the chat from its first message."
        placeholder="Chat name (optional)"
        optional
        onSubmit={async (name) => {
          const chat = await createChat.mutate({
            projectId: space.projectId,
            spaceId: space.id,
            name: name || undefined,
          });
          // Land on the fresh trunk so the first message can be typed
          // immediately — that message is what titles an unnamed chat.
          const branches = await window.ipc.invoke("branch:list", undefined);
          const trunk = branches.find((b) => b.chatId === chat.id);
          if (trunk) navigate(`/chats/${chat.id}/branches/${trunk.id}`);
        }}
      />
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename space"
        placeholder="Space name"
        submitLabel="Rename"
        initialValue={space.name}
        onSubmit={async (name) => {
          await renameSpace.mutate({ id: space.id, name });
        }}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete space"
        description={`"${space.name}" will be deleted along with ${impactSummary}. Anything already in the knowledge graph stays there. This can't be undone.`}
        onConfirm={async () => {
          const deleted = await deleteSpace.mutate({ id: space.id });
          if (!deleted) {
            toast.error("Couldn't delete space");
            return;
          }
          // If the user is looking at this space (or one of its chats), the
          // page under them just vanished — send them home.
          const inThisSpace =
            pathname.startsWith(`/spaces/${space.id}/`) ||
            chats.some((c) => pathname.startsWith(`/chats/${c.id}/`));
          if (inThisSpace) navigate("/");
        }}
      />
    </Collapsible>
  );
}

// Chat row semantics (GitHub-style): clicking the chat lands you on its trunk
// — the oldest live branch, "main" unless that was deleted. While a chat has
// a single branch the tree hides it entirely (the chat *is* the conversation);
// the branch list only appears once a fork makes the structure real.
function ChatItem({ chat, branches }: { chat: Chat; branches: Branch[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const renameChat = useMutation("chat:rename");
  const deleteChat = useMutation("chat:delete");
  const forkBranch = useMutation("branch:fork");
  const createBranch = useMutation("branch:create");
  const [renaming, setRenaming] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [impact, setImpact] = useState<{
    branches: number;
    artifacts: number;
    memories: number;
  } | null>(null);
  // Start expanded when the tree mounts with the route already inside this chat.
  const [open, setOpen] = useState(() => pathname.startsWith(`/chats/${chat.id}/`));

  const defaultBranch = branches[0] as Branch | undefined;
  const withinChat = pathname.startsWith(`/chats/${chat.id}/`);

  const openDeleteConfirm = async () => {
    try {
      setImpact(await window.ipc.invoke("chat:impact", { id: chat.id }));
    } catch {
      setImpact(null); // fall back to generic copy rather than blocking the dialog
    }
    setConfirmingDelete(true);
  };

  const impactSummary = impact
    ? `${counted(impact.artifacts, "artifact")}, ${counted(impact.memories, "memory", "memories")} and ${counted(impact.branches, "branch", "branches")}`
    : "everything in it";

  const chatRow = (isActive: boolean) =>
    cn(
      rowClasses(isActive),
      // On a non-default branch of this chat with the list collapsed, the
      // chat name still reads "you are in here".
      withinChat && !isActive && "text-fg",
      "group-data-[popup-open]/chat:bg-surface-1 group-data-[popup-open]/chat:text-fg",
    );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ContextMenu>
        {/* While this row's menu is open, hold the row in its hover state so
            it's obvious which chat the menu belongs to. */}
        <ContextMenuTrigger className="group/chat block w-full">
          {defaultBranch ? (
            <div className="flex items-center gap-0.5">
              {branches.length > 1 ? (
                <CollapsibleTrigger
                  aria-label={`Toggle branches of ${chat.name}`}
                  className="size-6 shrink-0 justify-center p-0 hover:bg-surface-1"
                />
              ) : (
                // Reserve the caret's footprint so leaf and expandable chat
                // names stay aligned.
                <span className="size-6 shrink-0" aria-hidden />
              )}
              <NavLink
                to={`/chats/${chat.id}/branches/${defaultBranch.id}`}
                onClick={() => setOpen(true)}
                className={({ isActive }) => cn(chatRow(isActive), "min-w-0 flex-1")}
              >
                <span className="truncate">{chat.name}</span>
              </NavLink>
            </div>
          ) : (
            // Branchless chat (shouldn't happen since chats are born with a
            // "main" trunk, but old data may lack one) — plain accordion.
            <CollapsibleTrigger className="w-full min-w-0 rounded-md px-2 py-1.5 text-label-md text-fg-muted hover:bg-surface-1 hover:text-fg group-data-[popup-open]/chat:bg-surface-1 group-data-[popup-open]/chat:text-fg">
              <span className="truncate">{chat.name}</span>
            </CollapsibleTrigger>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel className="max-w-52 truncate">{chat.name}</ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <PencilSimpleIcon />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setNewBranchOpen(true)}>
            <GitBranchIcon />
            New branch
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
            onClick={openDeleteConfirm}
          >
            <TrashIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {branches.length > 1 ? (
        <CollapsiblePanel>
          <div className="ml-3.5 space-y-0.5 border-l border-line pb-1.5 pl-1.5 pt-0.5">
            {branches.map((branch) => (
              <BranchItem key={branch.id} chat={chat} branch={branch} />
            ))}
          </div>
        </CollapsiblePanel>
      ) : !defaultBranch ? (
        <CollapsiblePanel>
          <div className="ml-3.5 space-y-0.5 border-l border-line pb-1.5 pl-1.5 pt-0.5">
            <p className="px-2 py-1 text-body-sm text-fg-subtle">No branches yet</p>
          </div>
        </CollapsiblePanel>
      ) : null}

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename chat"
        placeholder="Chat name"
        submitLabel="Rename"
        initialValue={chat.name}
        onSubmit={async (name) => {
          await renameChat.mutate({ id: chat.id, name });
        }}
      />
      <NameDialog
        open={newBranchOpen}
        onOpenChange={setNewBranchOpen}
        title="New branch"
        description={
          defaultBranch
            ? `Forks "${defaultBranch.name}" at its current head into a new branch of "${chat.name}".`
            : `Creates the first branch of "${chat.name}".`
        }
        placeholder="Branch name"
        submitLabel="Create"
        onSubmit={async (name) => {
          try {
            const branch = defaultBranch
              ? await forkBranch.mutate({ branchId: defaultBranch.id, name })
              : await createBranch.mutate({ name, model: "", chatId: chat.id });
            setOpen(true);
            navigate(`/chats/${chat.id}/branches/${branch.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create branch");
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete chat"
        description={`"${chat.name}" will be deleted along with ${impactSummary}. Anything already in the knowledge graph stays there. This can't be undone.`}
        onConfirm={async () => {
          const deleted = await deleteChat.mutate({ id: chat.id });
          if (!deleted) {
            toast.error("Couldn't delete chat");
            return;
          }
          // If the user is on one of this chat's branches, the page under
          // them just vanished — send them home.
          if (pathname.startsWith(`/chats/${chat.id}/`)) navigate("/");
        }}
      />
    </Collapsible>
  );
}

// Branch row — the actual navigation target, with the management context
// menu. The menu leads with "chat / branch" so it's clear whose menu it is.
function BranchItem({ chat, branch }: { chat: Chat; branch: Branch }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const renameBranch = useMutation("branch:rename");
  const deleteBranch = useMutation("branch:delete");
  const forkBranch = useMutation("branch:fork");
  const [renaming, setRenaming] = useState(false);
  const [forking, setForking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const exportMarkdown = async () => {
    const path = await window.ipc.invoke("branch:export", { id: branch.id, format: "markdown" });
    if (path) toast.success(`Exported to ${path}`);
  };

  return (
    <>
      <ContextMenu>
        {/* While this row's menu is open, hold the row in its hover state so
            it's obvious which branch the menu belongs to. */}
        <ContextMenuTrigger className="group/branch block w-full">
          <NavLink
            to={`/chats/${chat.id}/branches/${branch.id}`}
            className={({ isActive }) =>
              cn(
                rowClasses(isActive),
                "group-data-[popup-open]/branch:bg-surface-1 group-data-[popup-open]/branch:text-fg",
              )
            }
          >
            <GitBranchIcon size={14} className="shrink-0 text-fg-subtle" />
            <span className="truncate">{branch.name}</span>
          </NavLink>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel className="max-w-52 truncate">
              {chat.name} / {branch.name}
            </ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <PencilSimpleIcon />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setForking(true)}>
            <GitForkIcon />
            Fork
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExportIcon />
              Export
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={exportMarkdown}>
                <FileMdIcon />
                Markdown
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text"
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename branch"
        description={`In "${chat.name}"`}
        placeholder="Branch name"
        submitLabel="Rename"
        initialValue={branch.name}
        onSubmit={async (name) => {
          await renameBranch.mutate({ id: branch.id, name });
        }}
      />
      <NameDialog
        open={forking}
        onOpenChange={setForking}
        title="Fork branch"
        description={`Forks "${branch.name}" at its current head into a new branch of "${chat.name}".`}
        placeholder="New branch name"
        submitLabel="Fork"
        onSubmit={async (name) => {
          try {
            const fork = await forkBranch.mutate({ branchId: branch.id, name });
            navigate(`/chats/${chat.id}/branches/${fork.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fork failed");
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete branch"
        description={`"${branch.name}" of "${chat.name}" will be deleted. This can't be undone.`}
        onConfirm={async () => {
          await deleteBranch.mutate({ id: branch.id });
          if (pathname.endsWith(`/branches/${branch.id}`)) navigate("/");
        }}
      />
    </>
  );
}
