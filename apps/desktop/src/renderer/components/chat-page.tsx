import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  CubeIcon,
  ImagesIcon,
  LightningIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  StopIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { counted } from "../lib/utils";
import { invalidateQueries, useBranches, useMessages, useMutation } from "../hooks/use-ipc-data";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { Composer, ComposerButton } from "./ui/composer";
import { KbdGroup } from "./ui/kbd";
import { Markdown } from "./ui/markdown";
import { Marker, MarkerContent, MarkerIcon } from "./ui/marker";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageTimestamp,
} from "./ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./ui/message-scroller";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuShortcut, MenuTrigger } from "./ui/menu";
import { Spinner } from "./ui/spinner";

// ─────────────────────────────────────────────────────────────────────────────
// Chat / branch page — the composer + message scroller composed against real
// IPC: chat:send / chat:stream (text deltas, tool activity, done, error),
// message:edit/delete/undo for the edit-and-resend / retry / regenerate
// flows. Per-message fork is deliberately omitted — branch:fork only ever
// forks at the branch's current head, and the sidebar's branch row already
// exposes that; a message-level button here would imply a capability
// (fork-from-this-point) the backend doesn't have.
// ─────────────────────────────────────────────────────────────────────────────

type ToolCallState = { name: string; status: "running" | "done" | "error" };

interface StreamState {
  text: string;
  toolCalls: ToolCallState[];
}

interface ErrorState {
  turn: number;
  message: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPage() {
  const { branchId } = useParams();
  const { data: branches } = useBranches();
  const branch = branches?.find((b) => b.id === branchId);

  const { data: messages } = useMessages(branchId);

  const sendMessage = useMutation("chat:send");
  const abortChat = useMutation("chat:abort");
  const editMessage = useMutation("message:edit");
  const deleteMessage = useMutation("message:delete");
  const undoTurn = useMutation("message:undo");

  const [draft, setDraft] = useState("");
  const [editingTurn, setEditingTurn] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState<StreamState | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  // The just-sent user message, shown immediately — chat:send's IPC reply
  // doesn't resolve until the whole turn (including the assistant's reply)
  // finishes, so waiting for a real refetch would leave the user's own
  // message invisible for the entire generation.
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const lastSentRef = useRef("");
  // Text deltas arrive as individual IPC messages — often hundreds per
  // second, each in its own task, each forcing a separate React render.
  // Buffer them and flush at most once per animation frame; the stream
  // reads smoother precisely because it renders less often.
  const textBufRef = useRef("");
  const flushFrameRef = useRef<number | null>(null);

  // Main runs one agent turn at a time for the whole window, not one per
  // branch — every event is tagged with the branchId it belongs to so a
  // turn still in flight for another branch (superseded, or just left
  // running while the user navigated away) never renders on this page.
  useEffect(() => {
    const flushText = () => {
      flushFrameRef.current = null;
      const chunk = textBufRef.current;
      if (!chunk) return;
      textBufRef.current = "";
      setStreaming((s) => (s ? { ...s, text: s.text + chunk } : s));
    };

    const off = window.ipc.on("chat:stream", (event) => {
      if (event.branchId !== branchId) return;
      if (event.type === "text") {
        textBufRef.current += event.text;
        if (flushFrameRef.current === null) {
          flushFrameRef.current = requestAnimationFrame(flushText);
        }
      } else if (event.type === "tool_start") {
        setStreaming((s) =>
          s ? { ...s, toolCalls: [...s.toolCalls, { name: event.name, status: "running" }] } : s,
        );
      } else if (event.type === "tool_end") {
        setStreaming((s) => {
          if (!s) return s;
          const toolCalls = [...s.toolCalls];
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (toolCalls[i]!.name === event.name && toolCalls[i]!.status === "running") {
              toolCalls[i] = { name: event.name, status: event.success ? "done" : "error" };
              break;
            }
          }
          return { ...s, toolCalls };
        });
      } else if (event.type === "done") {
        // done carries the authoritative full text — drop anything buffered.
        textBufRef.current = "";
        if (flushFrameRef.current !== null) {
          cancelAnimationFrame(flushFrameRef.current);
          flushFrameRef.current = null;
        }
        setStreaming((s) => (s ? { ...s, text: event.text } : s));
        // This mount may not be the one that called send() (e.g. the user
        // navigated away and back while it was still running) — refetch
        // unconditionally so the persisted reply shows up either way.
        invalidateQueries();
      } else if (event.type === "error") {
        setErrorState({
          turn: event.turn ?? -1,
          message: event.message,
          rateLimited: event.rateLimited,
          retryAfterSeconds: event.retryAfterSeconds,
        });
      }
    });
    return () => {
      off();
      textBufRef.current = "";
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, [branchId]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!branchId || !trimmed || sending) return;
    lastSentRef.current = trimmed;
    setErrorState(null);
    setSending(true);
    setPendingUser(trimmed);
    setStreaming({ text: "", toolCalls: [] });
    try {
      await sendMessage.mutate({ branchId, message: trimmed });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send message");
    } finally {
      setSending(false);
      setStreaming(null);
      setPendingUser(null);
    }
  };

  const submitDraft = (value: string) => {
    setDraft("");
    if (editingTurn !== null) {
      const turn = editingTurn;
      setEditingTurn(null);
      editMessage
        .mutate({ branchId: branchId!, turn })
        .then(() => send(value))
        .catch(() => toast.error("Couldn't save that edit"));
      return;
    }
    void send(value);
  };

  const retryTurn = (turn: number, content: string) => {
    editMessage
      .mutate({ branchId: branchId!, turn })
      .then(() => send(content))
      .catch(() => toast.error("Couldn't retry that message"));
  };

  const retryFailed = () => {
    if (!errorState) return;
    const { turn } = errorState;
    const text = lastSentRef.current;
    setErrorState(null);
    if (turn >= 0) {
      editMessage
        .mutate({ branchId: branchId!, turn })
        .then(() => send(text))
        .catch(() => toast.error("Couldn't retry that message"));
    } else {
      void send(text);
    }
  };

  const regenerate = (precedingUserText: string) => {
    undoTurn
      .mutate({ branchId: branchId! })
      .then(() => send(precedingUserText))
      .catch(() => toast.error("Couldn't regenerate that response"));
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  const turns = useMemo(
    () => (messages ?? []).filter((m) => m.role === "user" || m.role === "assistant"),
    [messages],
  );

  // Hide the optimistic bubble the moment the real refetch lands rather than
  // waiting for the fixed send()/finally cleanup — avoids a one-frame
  // duplicate of the same message.
  const lastTurn = turns[turns.length - 1];
  const showPendingUser = Boolean(
    pendingUser && !(lastTurn?.role === "user" && lastTurn.content === pendingUser),
  );

  if (branches && !branch) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-md text-fg-subtle">This branch no longer exists.</p>
      </div>
    );
  }

  const composer = (
    <Composer
      className="w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onSubmit={submitDraft}
      disabled={sending}
      placeholder={editingTurn !== null ? "Edit message…" : "Ask anything…"}
      leading={
        <Menu>
          <MenuTrigger render={<ComposerButton aria-label="Attach" />}>
            <PaperclipIcon size={18} />
          </MenuTrigger>
          <MenuContent side="top" align="start" sideOffset={10}>
            <MenuItem>
              <ImagesIcon /> Add files and photos
              <MenuShortcut>
                <KbdGroup keys={["⌘", "U"]} />
              </MenuShortcut>
            </MenuItem>
            <MenuSeparator />
            <MenuItem>
              <LightningIcon /> Skills
            </MenuItem>
            <MenuItem>
              <CubeIcon /> Artifacts
            </MenuItem>
            <MenuItem>
              <BrainIcon /> Memories
            </MenuItem>
          </MenuContent>
        </Menu>
      }
    />
  );

  const empty = turns.length === 0 && !streaming;

  if (empty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
        <div className="text-center">
          <h1 className="text-heading-md text-fg">Ask anything</h1>
          <p className="mt-1 text-body-md text-fg-muted">
            {branch ? `Starts a new thread on “${branch.name}”.` : "Start the conversation."}
          </p>
        </div>
        <div className="w-full max-w-2xl">{composer}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-6 py-6">
            <MessageScrollerContent className="mx-auto w-full max-w-2xl">
              {turns.map((m, i) => {
                const isLastAssistant = m.role === "assistant" && i === turns.length - 1 && !streaming;
                const precedingUser = isLastAssistant ? turns[i - 1] : undefined;
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id}>
                    <Message role={m.role as "user" | "assistant"}>
                      <MessageContent>
                        <Markdown text={m.content} />
                      </MessageContent>
                      <MessageActions>
                        {m.role === "user" ? (
                          <>
                            <MessageAction
                              label="Edit message"
                              onClick={() => {
                                setEditingTurn(m.turn);
                                setDraft(m.content);
                              }}
                            >
                              <PencilSimpleIcon />
                            </MessageAction>
                            <MessageAction label="Copy message" onClick={() => copy(m.content)}>
                              <CopyIcon />
                            </MessageAction>
                            <MessageAction label="Retry" onClick={() => retryTurn(m.turn, m.content)}>
                              <ArrowsClockwiseIcon />
                            </MessageAction>
                            <MessageAction
                              label="Delete"
                              className="hover:bg-danger-soft hover:text-danger"
                              onClick={() =>
                                deleteMessage
                                  .mutate({ branchId: branchId!, turn: m.turn })
                                  .catch(() => toast.error("Couldn't delete that message"))
                              }
                            >
                              <TrashIcon />
                            </MessageAction>
                            <MessageTimestamp>{formatTime(m.timestamp)}</MessageTimestamp>
                          </>
                        ) : (
                          <>
                            <MessageAction label="Copy response" onClick={() => copy(m.content)}>
                              <CopyIcon />
                            </MessageAction>
                            {precedingUser && (
                              <MessageAction
                                label="Regenerate"
                                onClick={() => regenerate(precedingUser.content)}
                              >
                                <ArrowsClockwiseIcon />
                              </MessageAction>
                            )}
                            <MessageTimestamp>{formatTime(m.timestamp)}</MessageTimestamp>
                          </>
                        )}
                      </MessageActions>
                    </Message>
                  </MessageScrollerItem>
                );
              })}

              {showPendingUser && (
                <MessageScrollerItem messageId="__pending-user" className="[content-visibility:visible]">
                  <Message role="user">
                    <MessageContent>
                      <Markdown text={pendingUser!} />
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}

              {streaming && (
                // Overrides the base item's content-visibility:auto — this
                // element mutates in place on every token, and Chromium can
                // otherwise defer painting those in-place updates until
                // something else forces a layout pass (e.g. the final swap
                // to persisted messages), making the whole reply appear to
                // "pop in" at once instead of streaming.
                <MessageScrollerItem messageId="__streaming" className="[content-visibility:visible]">
                  <Message role="assistant">
                    {streaming.toolCalls.length > 0 && <ToolActivity calls={streaming.toolCalls} />}
                    {streaming.text ? (
                      <MessageContent>
                        <Markdown text={streaming.text} />
                      </MessageContent>
                    ) : streaming.toolCalls.length === 0 ? (
                      <TypingDots />
                    ) : null}
                  </Message>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="mx-auto w-full max-w-2xl shrink-0 px-6 pb-6">
        {errorState && (
          <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-line bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger-text">
            <WarningCircleIcon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1">
              {errorState.message}
              {errorState.rateLimited && errorState.retryAfterSeconds
                ? ` Try again in ${errorState.retryAfterSeconds}s.`
                : ""}
            </span>
            <Button variant="ghost" size="sm" onClick={retryFailed}>
              Retry
            </Button>
          </div>
        )}
        {editingTurn !== null && (
          <div className="mb-2 flex items-center gap-2 text-body-sm text-fg-muted">
            <PencilSimpleIcon size={14} className="shrink-0" />
            <span className="min-w-0 flex-1">
              Editing a previous message — sending discards everything after it.
            </span>
            <button
              type="button"
              className="pressable shrink-0 rounded-sm px-1.5 py-0.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
              onClick={() => {
                setEditingTurn(null);
                setDraft("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {sending && (
          <div className="mb-2 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => abortChat.mutate(undefined).catch(() => {})}
            >
              <StopIcon weight="fill" />
              Stop
            </Button>
          </div>
        )}
        {composer}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool activity — collapsible list of the current turn's tool calls, same
// grammar as the "Explored 4 files" marker in the gallery.
// ─────────────────────────────────────────────────────────────────────────────

function ToolActivity({ calls }: { calls: ToolCallState[] }) {
  const running = calls.some((c) => c.status === "running");
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger>
        {running ? <Spinner size="sm" /> : <CheckIcon size={12} weight="bold" />}
        {counted(calls.length, "tool call")}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-1 pb-1 pl-1 pt-1.5">
          {calls.map((call, i) => (
            <Marker key={i}>
              <MarkerIcon>
                {call.status === "running" ? (
                  <Spinner size="sm" />
                ) : call.status === "error" ? (
                  <WarningCircleIcon />
                ) : (
                  <CheckIcon />
                )}
              </MarkerIcon>
              <MarkerContent className="font-mono text-[12px]">{call.name}</MarkerContent>
            </Marker>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 150}ms` }}
          className="size-1.5 animate-typing rounded-full bg-fg-subtle"
        />
      ))}
    </span>
  );
}
