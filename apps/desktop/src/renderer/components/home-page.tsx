import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  ChatCircleIcon,
  CoinsIcon,
  GitBranchIcon,
  GitDiffIcon,
  GraphIcon,
  NoteIcon,
  StackIcon,
} from "@phosphor-icons/react";
import type { Branch, Chat } from "@squirl/shared";
import { counted } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import {
  useArtifacts,
  useBranches,
  useChats,
  useMutation,
  useProjectCosts,
  useSpaces,
  useUser,
} from "../hooks/use-ipc-data";
import { listIcon } from "./artifacts-page";
import { Button } from "./ui/button";
import { Composer } from "./ui/composer";
import { greetingLine } from "./chat/message-parts";

// ─────────────────────────────────────────────────────────────────────────────
// Home — the project's front door, not a chat welcome screen. Project
// identity leads (name as the real heading, like a doc title — "Good
// afternoon" is demoted to an eyebrow), Spaces and the rest of the project
// get surfaced alongside chats/outputs so this reads as a gateway into the
// whole project, not a chat-history page with an extra section bolted on.
// Composer stays the one functional hero; everything else is quiet rows —
// this app's language for "many small facts" (Automations, the sidebar tree)
// is a bordered row-group, never KPI tiles or a grid of cards.
// ─────────────────────────────────────────────────────────────────────────────

const fmtCost = (c: number) => `$${c < 0.1 ? c.toFixed(4) : c.toFixed(2)}`;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Shared row shell — one bordered group, hairline dividers, same anatomy the
// Automations settings list uses.
function RowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
      {children}
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  subtitle,
  meta,
  onClick,
  disabled,
}: {
  icon: typeof ChatCircleIcon;
  title: string;
  subtitle?: ReactNode;
  meta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-100 hover:bg-surface-1 disabled:opacity-50"
    >
      <Icon size={18} className="shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label-md text-fg">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">{subtitle}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{meta}</span>
    </button>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-heading-sm text-fg">{title}</h2>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="flex items-center gap-1 text-label-sm text-fg-subtle transition-colors duration-100 hover:text-fg"
        >
          See all <ArrowRightIcon size={11} />
        </button>
      )}
    </div>
  );
}

export function HomePage() {
  const { activeProject, activeProjectId } = useWorkspace();
  const { data: user } = useUser();
  const { data: chats, loading: chatsLoading } = useChats(activeProjectId);
  const { data: spaces } = useSpaces(activeProjectId);
  const { data: artifacts } = useArtifacts(activeProjectId);
  const { data: branches } = useBranches();
  const { data: costs } = useProjectCosts(activeProjectId);
  const createChat = useMutation("chat:create");
  const navigate = useNavigate();

  const spaceName = useMemo(() => {
    const map = new Map((spaces ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id);
  }, [spaces]);

  const chatCountForSpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chat of chats ?? []) counts.set(chat.spaceId, (counts.get(chat.spaceId) ?? 0) + 1);
    return (id: string) => counts.get(id) ?? 0;
  }, [chats]);

  // Trunk = the chat's oldest branch — same resolution the sidebar's chat
  // rows use, so a row here lands you exactly where clicking it there would.
  const trunkOf = (chat: Chat): Branch | undefined =>
    (branches ?? []).filter((b) => b.chatId === chat.id)[0];

  const recentChats = useMemo(
    () => [...(chats ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
    [chats],
  );

  const recentArtifacts = useMemo(
    () => [...(artifacts ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [artifacts],
  );

  const handleSend = async (text: string) => {
    if (!activeProjectId) return;
    try {
      const chat = await createChat.mutate({ projectId: activeProjectId });
      const freshBranches = await window.ipc.invoke("branch:list", undefined);
      const trunk = freshBranches.find((b) => b.chatId === chat.id);
      if (!trunk) throw new Error("New chat has no trunk branch");
      navigate(`/chats/${chat.id}/branches/${trunk.id}`, { state: { initialMessage: text } });
    } catch {
      toast.error("Couldn't start a new chat");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-10 py-12">
        {/* Header — project identity leads, like a document title. The
            personal greeting is demoted to an eyebrow above it. */}
        <p className="text-body-sm text-fg-subtle">{greetingLine(user?.name)}</p>
        <h1 className="mt-1 text-heading-lg text-fg">{activeProject?.name ?? "Home"}</h1>
        <p className="mt-1 text-body-md text-fg-muted">
          {activeProject?.description || "What shall we build today?"}
        </p>

        <div className="mt-6">
          <Composer onSubmit={handleSend} placeholder="Ask anything…" />
        </div>

        {/* Stats as a sentence, not tiles — this app doesn't do KPI cards. */}
        <p className="mt-3 text-body-sm text-fg-subtle">
          {counted(chats?.length ?? 0, "chat")} · {counted(artifacts?.length ?? 0, "artifact")} ·{" "}
          {counted(spaces?.length ?? 0, "space")} ·{" "}
          <span className="font-mono">{fmtCost(costs?.totalCost ?? 0)}</span> spent
        </p>

        {/* Spaces — the project's functional areas, otherwise buried in the
            sidebar tree. Only the chat count is shown: artifacts/memories
            aren't reliably scoped to a space in the data model yet, so
            showing counts for those here would just be making numbers up. */}
        {spaces && spaces.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                onClick={() => navigate(`/spaces/${space.id}/artifacts`)}
                className="rounded-lg border border-line bg-surface-1 px-3.5 py-2 text-label-sm text-fg transition-colors duration-100 hover:border-line-strong hover:bg-surface-2"
              >
                <StackIcon size={13} className="mr-1.5 inline -translate-y-px text-fg-subtle" />
                {space.name}
                <span className="ml-1.5 font-mono text-[11px] text-fg-subtle">
                  {counted(chatCountForSpace(space.id), "chat")}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Explore — the rest of the project, one click away from Home
            instead of only reachable via the sidebar footer. */}
        <div className="mt-3 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/knowledge-base")}>
            <NoteIcon size={14} /> Knowledge base
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/graph")}>
            <GraphIcon size={14} /> Knowledge graph
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/branches/compare")}>
            <GitDiffIcon size={14} /> Compare branches
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/costs")}>
            <CoinsIcon size={14} /> Costs
          </Button>
        </div>

        {recentArtifacts.length > 0 && (
          <div className="mt-10">
            <SectionHeader title="Outputs" onSeeAll={() => navigate("/artifacts")} />
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {recentArtifacts.map((artifact) => {
                const Icon = listIcon(artifact);
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => navigate("/artifacts")}
                    className="w-56 shrink-0 rounded-lg border border-line bg-surface-1 p-4 text-left shadow-raised transition-colors duration-100 hover:border-line-strong hover:bg-surface-2"
                  >
                    <Icon size={18} className="text-fg-subtle" />
                    <p className="mt-3 line-clamp-2 text-label-md text-fg">{artifact.title}</p>
                    <p className="mt-2 font-mono text-[11px] text-fg-subtle">{timeAgo(artifact.updatedAt)}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-10">
          <SectionHeader title="Recent chats" />
          {chatsLoading && !chats ? null : recentChats.length === 0 ? (
            <p className="mt-3 text-body-sm text-fg-subtle">No chats yet — start one above.</p>
          ) : (
            <RowGroup>
              {recentChats.map((chat) => {
                const trunk = trunkOf(chat);
                const branchCount = (branches ?? []).filter((b) => b.chatId === chat.id).length;
                return (
                  <Row
                    key={chat.id}
                    icon={ChatCircleIcon}
                    title={chat.name}
                    subtitle={
                      <>
                        {spaceName(chat.spaceId) ?? "—"}
                        {branchCount > 1 && (
                          <>
                            {" · "}
                            <GitBranchIcon size={11} className="inline -translate-y-px" /> {branchCount}
                          </>
                        )}
                      </>
                    }
                    meta={timeAgo(chat.createdAt)}
                    disabled={!trunk}
                    onClick={() => trunk && navigate(`/chats/${chat.id}/branches/${trunk.id}`)}
                  />
                );
              })}
            </RowGroup>
          )}
        </div>
      </div>
    </div>
  );
}
