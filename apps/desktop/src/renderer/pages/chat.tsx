import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowUp, Square, Undo2, Sparkles, Check, X, Copy, Pencil, Trash2,
  ThumbsUp, MoreHorizontal, GitBranch, Pin,
} from "lucide-react";
import type { AgentStreamEvent } from "@ai-studio/event-bus";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";
import { LoadingState } from "../components/page-primitives";
import { Text } from "../components/ui/typography";
import { Markdown } from "../components/markdown";
import { useBranches, useMessages, useModels, useMutation, invalidateQueries } from "../hooks/use-ipc-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ChatMessage {
  id?: string;
  role: string;
  content: string;
  turn: number;
  timestamp?: number;
  tools?: ToolEvent[];
  /** Set when this message's response failed — shows an inline retry affordance. */
  failed?: boolean;
}

interface ToolEvent {
  name: string;
  status: "running" | "done" | "error";
}

/** Short relative/absolute time label for a message timestamp. */
function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ChatPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const navigate = useNavigate();
  const { data: branches = [] } = useBranches();
  const branch = branches.find((b) => b.id === branchId);
  const { data: initialMessages, loading, refetch } = useMessages(branchId);
  const { data: models = {} } = useModels();
  const updateModel = useMutation("branch:update-model");
  const deleteMessage = useMutation("message:delete");
  const createBranch = useMutation("branch:create");
  const addPin = useMutation("branch:pin-add");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [likedTurns, setLikedTurns] = useState<Set<number>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamTextRef = useRef("");
  const toolsRef = useRef<ToolEvent[]>([]);

  const handleModelChange = useCallback(async (model: string) => {
    if (!branchId || model === branch?.model) return;
    try {
      await updateModel.mutate({ id: branchId, model });
      toast.success(`Switched to ${model}`);
    } catch (err) {
      toast.error(`Failed to switch model: ${(err as Error).message}`);
    }
  }, [branchId, branch?.model, updateModel]);

  // Load persisted messages when branch changes
  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

  // Switch backend active branch
  useEffect(() => {
    if (branchId) window.ipc.invoke("branch:switch", { id: branchId }).catch(() => {});
  }, [branchId]);

  // Subscribe to the stream once
  useEffect(() => {
    const off = window.ipc.on("chat:stream", (event: AgentStreamEvent) => {
      switch (event.type) {
        case "text":
          streamTextRef.current += event.text;
          setStreamText(streamTextRef.current);
          break;
        case "tool_start":
          toolsRef.current = [...toolsRef.current, { name: event.name, status: "running" }];
          setTools(toolsRef.current);
          break;
        case "tool_end":
          toolsRef.current = toolsRef.current.map((t) =>
            t.name === event.name && t.status === "running"
              ? { ...t, status: event.success ? "done" : "error" }
              : t,
          );
          setTools(toolsRef.current);
          break;
        case "done": {
          const finalText = event.text || streamTextRef.current;
          const turnTools = toolsRef.current;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: finalText,
              turn: prev.length,
              tools: turnTools.length ? turnTools : undefined,
            },
          ]);
          streamTextRef.current = "";
          toolsRef.current = [];
          setStreamText("");
          setStreaming(false);
          setTools([]);
          // Refresh right-panel data (artifacts, memories, usage) after the turn.
          invalidateQueries();
          break;
        }
        case "error":
          if (event.rateLimited) {
            // Rate limits are expected/transient, not a hard failure — the
            // warning style (vs. error) reads calmer, and staying on screen
            // long enough to cover the suggested retry wait means it doesn't
            // vanish before the user's had a chance to read it.
            toast.warning(event.message, {
              duration: event.retryAfterSeconds ? Math.max(4000, (event.retryAfterSeconds + 2) * 1000) : 5000,
            });
          } else {
            toast.error(event.message);
          }
          if (typeof event.turn === "number") {
            const failedTurn = event.turn;
            setMessages((prev) =>
              prev.map((m) => (m.turn === failedTurn && m.role === "user" ? { ...m, failed: true } : m)),
            );
          }
          streamTextRef.current = "";
          toolsRef.current = [];
          setStreamText("");
          setStreaming(false);
          setTools([]);
          break;
      }
    });
    return off;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText, tools]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !branchId || streaming) return;
    setMessages((prev) => [...prev, { role: "user", content: text, turn: prev.length }]);
    setInput("");
    setStreaming(true);
    streamTextRef.current = "";
    toolsRef.current = [];
    setTools([]);
    setStreamText("");
    try {
      await window.ipc.invoke("chat:send", { branchId, message: text });
    } catch (err) {
      toast.error(`Failed to send: ${(err as Error).message}`);
      setStreaming(false);
    }
  }, [input, branchId, streaming]);

  const abort = useCallback(async () => {
    await window.ipc.invoke("chat:abort", undefined);
    setStreaming(false);
    if (streamTextRef.current) {
      const turnTools = toolsRef.current;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: streamTextRef.current,
          turn: prev.length,
          tools: turnTools.length ? turnTools : undefined,
        },
      ]);
    }
    streamTextRef.current = "";
    toolsRef.current = [];
    setStreamText("");
    setTools([]);
  }, []);

  const undo = useCallback(async () => {
    if (!branchId) return;
    await window.ipc.invoke("message:undo", { branchId });
    await refetch();
    toast.success("Undid last turn");
  }, [branchId, refetch]);

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }, []);

  const toggleLike = useCallback((turn: number) => {
    setLikedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  }, []);

  /** Delete a user message and its paired assistant response. */
  const deleteUserMessage = useCallback(async (turn: number) => {
    if (!branchId) return;
    try {
      await deleteMessage.mutate({ branchId, turn });
      await refetch();
      toast.success("Message deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${(err as Error).message}`);
    }
  }, [branchId, deleteMessage, refetch]);

  /** Save an edited user message, drop everything after it, and regenerate a response. */
  const saveEditedMessage = useCallback(async (turn: number, content: string) => {
    if (!branchId || !content.trim() || streaming) return;
    try {
      // Invoke the channel directly rather than via the `editMessage`
      // mutation wrapper — that wrapper calls invalidateQueries() the
      // instant this resolves, which refetches message:list at the exact
      // moment the old turn is deleted but the retried one hasn't been
      // re-added yet (that happens below, inside chat:send). The stale
      // fetch then lands and overwrites the optimistic state update below,
      // making the just-retried prompt vanish mid-stream. The "done" event
      // handler already invalidates queries once the new turn is real.
      await window.ipc.invoke("message:edit", { branchId, turn });
      setMessages((prev) => [
        ...prev.filter((m) => m.turn < turn),
        { role: "user", content: content.trim(), turn },
      ]);
      setStreaming(true);
      streamTextRef.current = "";
      toolsRef.current = [];
      setTools([]);
      setStreamText("");
      await window.ipc.invoke("chat:send", { branchId, message: content.trim() });
    } catch (err) {
      toast.error(`Failed to edit: ${(err as Error).message}`);
      setStreaming(false);
    }
  }, [branchId, streaming]);

  /** Fork a new branch starting right after this message's turn. */
  const branchFromHere = useCallback(async (turn: number) => {
    if (!branchId || !branch) return;
    try {
      const newBranch = await createBranch.mutate({
        name: `${branch.name}-fork`,
        model: branch.model,
        parentId: branchId,
        forkAtIndex: turn + 1,
        chatId: branch.chatId,
      });
      toast.success("Branched from this message");
      navigate(`/chat/${newBranch.id}`);
    } catch (err) {
      toast.error(`Failed to branch: ${(err as Error).message}`);
    }
  }, [branchId, branch, createBranch, navigate]);

  /** Pin an assistant response's content to the branch's context. */
  const pinMessage = useCallback(async (content: string) => {
    if (!branchId) return;
    try {
      await addPin.mutate({ branchId, text: content });
      toast.success("Pinned to context");
    } catch (err) {
      toast.error(`Failed to pin: ${(err as Error).message}`);
    }
  }, [branchId, addPin]);

  if (!branchId) return null;
  if (loading && messages.length === 0) return <LoadingState label="Loading conversation…" />;

  const isEmpty = messages.length === 0 && !streaming;

  const composer = (
    <div
      className={cn(
        "rounded-2xl border bg-card transition-all duration-300",
        streaming
          ? "animate-glow-breathe border-primary/30"
          : isEmpty
            ? "glow-hero border-border focus-within:glow-hero-strong focus-within:border-ring/40"
            : "border-border shadow-md focus-within:glow-hero focus-within:border-ring/40",
      )}
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={isEmpty ? "Ask anything…" : "Reply — context carries forward…"}
        rows={2}
        autoFocus
        className="w-full resize-none border-0 bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {branch && (
            <Select value={branch.model} onValueChange={handleModelChange}>
              <SelectTrigger className="h-6 w-auto shrink-0 gap-1 border-none bg-muted px-2 py-0 text-[11px] font-code-sm text-muted-foreground hover:text-foreground [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(models).map(([provider, ids]) => (
                  <SelectGroup key={provider}>
                    <SelectLabel>{provider}</SelectLabel>
                    {ids.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                {/* Ensure the branch's current model is always selectable even if its provider key is momentarily missing. */}
                {!Object.values(models).some((ids) => ids.includes(branch.model)) && (
                  <SelectItem value={branch.model}>{branch.model}</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
          <span className="truncate px-1 text-[11px] text-muted-foreground/50">
            Enter to send · Shift+Enter for newline
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isEmpty && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={undo}
              disabled={messages.length === 0 || streaming}
              title="Undo last turn"
              className="text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {streaming ? (
            <Button
              variant="secondary"
              size="icon-sm"
              className="pressable rounded-full"
              onClick={abort}
              title="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="pressable rounded-full"
              onClick={send}
              disabled={!input.trim()}
              title="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {isEmpty ? (
        /* Hero state — the composer IS the screen until the first message */
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
          <div className="stagger-children w-full max-w-xl">
            <div className="mb-6 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <p className="font-h3 mt-4">What are we working on?</p>
              <Text size="sm" variant="muted" className="mt-1">
                Everything you decide here stays on this branch — nothing gets re-explained.
              </Text>
            </div>
            {composer}
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-6 py-8">
              <div className="space-y-7">
                {messages.map((msg, i) => (
                  <Message
                    key={msg.id ?? i}
                    role={msg.role}
                    content={msg.content}
                    tools={msg.tools}
                    timestamp={msg.timestamp}
                    liked={likedTurns.has(msg.turn)}
                    failed={msg.failed}
                    onCopy={() => copyMessage(msg.content)}
                    onDelete={msg.role === "user" ? () => deleteUserMessage(msg.turn) : undefined}
                    onSaveEdit={msg.role === "user" ? (text) => saveEditedMessage(msg.turn, text) : undefined}
                    onRetry={msg.failed ? () => saveEditedMessage(msg.turn, msg.content) : undefined}
                    onLike={msg.role === "assistant" ? () => toggleLike(msg.turn) : undefined}
                    onBranchFromHere={msg.role === "assistant" ? () => branchFromHere(msg.turn) : undefined}
                    onPin={msg.role === "assistant" ? () => pinMessage(msg.content) : undefined}
                  />
                ))}

                {/* Live tool activity */}
                {tools.length > 0 && <ToolActivity tools={tools} />}

                {/* Streaming assistant text — dots until the first token lands */}
                {streaming &&
                  (streamText ? (
                    <Message role="assistant" content={streamText} streaming />
                  ) : (
                    tools.length === 0 && <ThinkingDots />
                  ))}
              </div>
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 px-6 pb-5 pt-2">
            <div className="mx-auto max-w-2xl">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ThinkingDots — shown between send and the first streamed token
// ─────────────────────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="animate-rise flex items-center gap-1 py-1" aria-label="Thinking…">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message — user turns read as quiet right-aligned bubbles; assistant turns
// read as full-width prose. No avatars: alignment carries the speaker.
// ─────────────────────────────────────────────────────────────────────────────

function Message({
  role,
  content,
  streaming,
  tools,
  timestamp,
  liked,
  failed,
  onCopy,
  onDelete,
  onSaveEdit,
  onRetry,
  onLike,
  onBranchFromHere,
  onPin,
}: {
  role: string;
  content: string;
  streaming?: boolean;
  tools?: ToolEvent[];
  timestamp?: number;
  liked?: boolean;
  failed?: boolean;
  onCopy?: () => void;
  onDelete?: () => void;
  onSaveEdit?: (content: string) => void;
  onRetry?: () => void;
  onLike?: () => void;
  onBranchFromHere?: () => void;
  onPin?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (role === "user") {
    if (editing) {
      return (
        <div className="animate-rise flex justify-end">
          <div className="w-full max-w-[80%] rounded-2xl rounded-br-md border border-ring/40 bg-muted p-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={Math.min(8, Math.max(2, editText.split("\n").length))}
              autoFocus
              className="w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-relaxed outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditing(false); setEditText(content); }
              }}
            />
            <div className="flex justify-end gap-1.5 px-1 pb-1">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setEditText(content); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => { onSaveEdit?.(editText); setEditing(false); }}
                disabled={!editText.trim()}
              >
                Save &amp; regenerate
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="animate-rise group flex flex-col items-end gap-1">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-relaxed">
          {content}
        </div>
        {failed && (
          <div className="flex items-center gap-1.5 px-1.5">
            <Text size="xs" className="text-destructive">
              Failed to respond
            </Text>
            <button
              onClick={onRetry}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {timestamp !== undefined && (
            <Text size="xs" variant="subtle" className="px-1.5">
              {formatTimestamp(timestamp)}
            </Text>
          )}
          <Button variant="ghost" size="icon-sm" title="Copy" onClick={onCopy}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Popover open={confirmingDelete} onOpenChange={setConfirmingDelete}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="Delete">
                <Trash2 className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end">
              <Text size="sm" className="font-medium text-foreground">
                Delete this message?
              </Text>
              <Text size="xs" variant="muted" className="mt-1">
                This removes the prompt and its response. This can&apos;t be undone.
              </Text>
              <div className="mt-3 flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onDelete?.(); setConfirmingDelete(false); }}
                >
                  Delete
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise group space-y-2">
      {tools && tools.length > 0 && <ToolActivity tools={tools} />}
      <div className="break-words text-sm leading-relaxed">
        <Markdown content={content} />
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-full bg-primary align-middle" />
        )}
      </div>
      {!streaming && (onCopy || onLike || onBranchFromHere || onPin) && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {timestamp !== undefined && (
            <Text size="xs" variant="subtle" className="px-1.5">
              {formatTimestamp(timestamp)}
            </Text>
          )}
          {onCopy && (
            <Button variant="ghost" size="icon-sm" title="Copy" onClick={onCopy}>
              <Copy className="h-3 w-3" />
            </Button>
          )}
          {onLike && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Like"
              className={liked ? "text-primary" : undefined}
              onClick={onLike}
            >
              <ThumbsUp className={cn("h-3 w-3", liked && "fill-current")} />
            </Button>
          )}
          {(onBranchFromHere || onPin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="More">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {onBranchFromHere && (
                  <DropdownMenuItem onClick={onBranchFromHere}>
                    <GitBranch className="h-3.5 w-3.5" />
                    Branch from here
                  </DropdownMenuItem>
                )}
                {onPin && (
                  <DropdownMenuItem onClick={onPin}>
                    <Pin className="h-3.5 w-3.5" />
                    Pin to context
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ToolActivity — quiet, data-voiced rows instead of colored badges
// ─────────────────────────────────────────────────────────────────────────────

function ToolActivity({ tools }: { tools: ToolEvent[] }) {
  return (
    <div className="animate-rise flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-1.5">
      {tools.map((tool, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 font-code-sm text-muted-foreground">
          {tool.status === "running" ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-highlight" />
          ) : tool.status === "error" ? (
            <X className="h-3 w-3 text-destructive" />
          ) : (
            <Check className="h-3 w-3 text-success" />
          )}
          {tool.name}
        </span>
      ))}
    </div>
  );
}
