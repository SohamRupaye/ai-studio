import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { toast } from "sonner";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  CubeIcon,
  FileTextIcon,
  GitBranchIcon,
  GitForkIcon,
  GlobeIcon,
  ImagesIcon,
  LightningIcon,
  ListChecksIcon,
  NotebookIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PushPinIcon,
  StopIcon,
  TerminalWindowIcon,
  TrashIcon,
  TreeStructureIcon,
  WarningCircleIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { MessageImage, SubagentRunRecord, SubagentStreamEvent } from "@ai-studio/shared";
import { applySubagentEvent, newSubagentRecord } from "@ai-studio/shared";
import { cn, counted } from "../lib/utils";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";
import { invalidateQueries, useBranches, useMessages, useMutation, useSkills, useUser } from "../hooks/use-ipc-data";
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
  MessageModel,
  MessageTimestamp,
} from "./ui/message";
import { NameDialog } from "./name-dialog";
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
// flows. Assistant rows also expose "branch from here" (branch:create with
// forkAtIndex = that turn — git semantics, fork mid-history) and "pin"
// (branch:pin-add; pins feed the branch's context assembly).
// ─────────────────────────────────────────────────────────────────────────────

/** One delegated agent inside a subagent/delegate call — built live from
 * `subagent` stream events (via the same shared reducer main persists with),
 * or read back from the persisted message's tool_calls. runId/startedAt are
 * only present on live runs. */
type SubagentRun = SubagentRunRecord & { runId?: string; startedAt?: number };

type ToolCallState = {
  name: string;
  status: "running" | "done" | "error";
  /** Compact args (live: from tool_start; persisted: stored preview) — the
   * row answers "what did that call actually do". */
  argsPreview?: string;
  agents?: SubagentRun[];
};

/** One-line args preview for a LIVE tool_start event (persisted rows carry
 * the preview main stored). */
function liveArgsPreview(args: Record<string, unknown>): string | undefined {
  try {
    const text = JSON.stringify(args);
    if (!text || text === "{}") return undefined;
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return undefined;
  }
}

interface StreamState {
  text: string;
  toolCalls: ToolCallState[];
  /** Flat, arrival-ordered agent runs for this turn — grouped by runId and
   * matched to subagent/delegate tool calls in order at render time. */
  subagentRuns: SubagentRun[];
}

/** Groups live agent runs by runId (first-seen order) and attaches each group
 * to the turn's subagent/delegate calls in invocation order — the same
 * matching main uses when it persists the message. */
function attachLiveAgents(calls: ToolCallState[], runs: SubagentRun[]): ToolCallState[] {
  if (!runs.length) return calls;
  const groups: SubagentRun[][] = [];
  const groupIdx = new Map<string, number>();
  for (const r of runs) {
    let i = groupIdx.get(r.runId ?? "");
    if (i === undefined) {
      i = groups.length;
      groupIdx.set(r.runId ?? "", i);
      groups.push([]);
    }
    groups[i]!.push(r);
  }
  let gi = 0;
  return calls.map((c) =>
    (c.name === "subagent" || c.name === "delegate") && gi < groups.length
      ? { ...c, agents: groups[gi++] }
      : c,
  );
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

/** Base64 for IPC transport, chunked so large images don't blow the one-shot
 * String.fromCharCode argument limit. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Time-of-day greeting for the empty state — the sketch's "Good morning,
// Soham!" moment. Name comes from the user profile; degrades to just the
// greeting when none is set.
function greetingLine(name?: string): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${greeting}, ${name}` : greeting;
}

/** Loads a staged/attached image blob (main has the bytes; the renderer has no
 * filesystem access) and renders it. Shows nothing until the data URL arrives. */
function BlobImage({ blobPath, alt, className }: { blobPath: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    window.ipc.invoke("attachment:data", { blobPath }).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [blobPath]);
  if (!src) return <div className={className} aria-label={alt} />;
  return <img src={src} alt={alt} className={className} />;
}

function StagedImage({ blobPath, filename }: { blobPath: string; filename: string }) {
  return (
    <BlobImage
      blobPath={blobPath}
      alt={filename}
      className="size-16 rounded-lg border border-line object-cover"
    />
  );
}

/** A user message's text, with a leading "/skill" invocation rendered as a
 * chip when the name matches an installed skill (the message text itself IS
 * the command — no separate metadata to drift from it). */
function UserMessageBody({ text, skillNames }: { text: string; skillNames: ReadonlySet<string> }) {
  const match = /^\/([\w-]+)[ \t]*([\s\S]*)$/.exec(text);
  if (!match || !skillNames.has(match[1]!)) return <Markdown text={text} />;
  return (
    <div>
      <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-line bg-surface-1 px-2.5 py-0.5 font-mono text-[12px] text-fg">
        <LightningIcon size={12} weight="fill" />
        {match[1]}
      </span>
      {match[2] ? <Markdown text={match[2]} /> : null}
    </div>
  );
}

/** A turn's images, rendered ABOVE the bubble (never inside it — an image
 * inside MessageContent stretches the bubble around long text). Click opens
 * the fullscreen viewer. Follows the Message's own role alignment. */
function MessageImages({
  images,
  onOpen,
}: {
  images: MessageImage[];
  onOpen: (image: MessageImage) => void;
}) {
  return (
    <div className="flex max-w-[85%] flex-wrap gap-2 in-data-[role=user]:justify-end">
      {images.map((img) => (
        <button
          key={img.blobPath}
          type="button"
          aria-label={`View ${img.filename} fullscreen`}
          onClick={() => onOpen(img)}
          className="cursor-zoom-in overflow-hidden rounded-md border border-line transition-opacity hover:opacity-90"
        >
          <BlobImage blobPath={img.blobPath} alt={img.filename} className="max-h-48 object-contain" />
        </button>
      ))}
    </div>
  );
}

/** Fullscreen image viewer — Escape, the close button, or a click anywhere
 * dismisses it. */
function ImageLightbox({
  image,
  onClose,
}: {
  image: MessageImage | null;
  onClose: () => void;
}) {
  return (
    <BaseDialog.Root open={image !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/80 data-[open]:animate-fade-in data-[closed]:animate-fade-out" />
        <BaseDialog.Popup
          className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 p-8 outline-none data-[open]:animate-fade-in data-[closed]:animate-fade-out"
          onClick={onClose}
        >
          {image && (
            <>
              <BlobImage
                blobPath={image.blobPath}
                alt={image.filename}
                className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-xl"
              />
              <span className="text-body-sm text-white/70 select-none">{image.filename}</span>
            </>
          )}
          <BaseDialog.Close
            aria-label="Close"
            className="pressable absolute right-4 top-4 flex size-8 items-center justify-center rounded-md bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          >
            <XIcon size={18} />
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function ChatPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { data: branches } = useBranches();
  const branch = branches?.find((b) => b.id === branchId);
  const { data: user } = useUser();

  const { data: messages } = useMessages(branchId);

  const sendMessage = useMutation("chat:send");
  const abortChat = useMutation("chat:abort");
  const editMessage = useMutation("message:edit");
  const deleteMessage = useMutation("message:delete");
  const undoTurn = useMutation("message:undo");
  const createBranch = useMutation("branch:create");
  const addPin = useMutation("branch:pin-add");

  const [draft, setDraft] = useState("");
  const [editingTurn, setEditingTurn] = useState<number | null>(null);
  // Slash-command skill picker: opens while the draft is a bare "/token"
  // (autocomplete) or from the attach menu (browse mode, all enabled skills).
  const { data: skillList } = useSkills();
  const enabledSkills = useMemo(() => (skillList ?? []).filter((s) => s.enabled), [skillList]);
  // Installed names (disabled included) — past transcripts keep their chips
  // even after a skill is disabled.
  const skillNames = useMemo(() => new Set((skillList ?? []).map((s) => s.name)), [skillList]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  // Turn to fork at — set by an assistant row's "Branch from here", drives
  // the name dialog.
  const [branchingFromTurn, setBranchingFromTurn] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState<StreamState | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  // The just-sent user message, shown immediately — chat:send's IPC reply
  // doesn't resolve until the whole turn (including the assistant's reply)
  // finishes, so waiting for a real refetch would leave the user's own
  // message invisible for the entire generation.
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  // Images staged (copied into blobs) but not yet sent — ride the next message.
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  // Images on the just-sent turn, shown in the optimistic bubble during
  // generation (mirrors pendingUser) until the real message refetches.
  const [pendingUserImages, setPendingUserImages] = useState<MessageImage[]>([]);
  // Image open in the fullscreen viewer, or null.
  const [viewerImage, setViewerImage] = useState<MessageImage | null>(null);
  // Delegated agent open in the detail dialog — set by clicking an agent row
  // in a subagent/delegate call's activity.
  const [agentDetail, setAgentDetail] = useState<SubagentRun | null>(null);
  const lastSentRef = useRef("");
  // Images that rode the last send — Retry must resend them too (the composer
  // chips are cleared optimistically, so this is the only surviving reference
  // when a send fails, e.g. the "model can't view images" gate).
  const lastSentImagesRef = useRef<MessageImage[]>([]);
  // Text deltas arrive as individual IPC messages — often hundreds per
  // second, each in its own task, each forcing a separate React render.
  // Buffer them and flush at most once per animation frame; the stream
  // reads smoother precisely because it renders less often.
  const textBufRef = useRef("");
  // Subagent transcripts stream per-delta too (× up to 4 agents) — they ride
  // the same frame-batched flush as the main text.
  const subagentBufRef = useRef<SubagentStreamEvent[]>([]);
  const flushFrameRef = useRef<number | null>(null);

  // Main runs one agent turn at a time for the whole window, not one per
  // branch — every event is tagged with the branchId it belongs to so a
  // turn still in flight for another branch (superseded, or just left
  // running while the user navigated away) never renders on this page.
  useEffect(() => {
    const flushStream = () => {
      flushFrameRef.current = null;
      const chunk = textBufRef.current;
      const subEvents = subagentBufRef.current;
      if (!chunk && !subEvents.length) return;
      textBufRef.current = "";
      subagentBufRef.current = [];
      setStreaming((s) => {
        if (!s) return s;
        let next = s;
        if (chunk) next = { ...next, text: next.text + chunk };
        if (subEvents.length) {
          // The reducer mutates — clone the runs it will touch, then fold the
          // buffered events in (same reducer main persists with).
          const runs: SubagentRun[] = next.subagentRuns.map((r) => ({
            ...r,
            steps: r.steps.map((step) => ({ ...step })),
          }));
          for (const ev of subEvents) {
            let run = runs.find((r) => r.runId === ev.runId && r.agentId === ev.agentId);
            if (!run) {
              run = { ...newSubagentRecord(ev.agentId), runId: ev.runId, startedAt: Date.now() };
              runs.push(run);
            }
            applySubagentEvent(run, ev);
          }
          next = { ...next, subagentRuns: runs };
        }
        return next;
      });
    };
    const scheduleFlush = () => {
      if (flushFrameRef.current === null) {
        flushFrameRef.current = requestAnimationFrame(flushStream);
      }
    };

    const off = window.ipc.on("chat:stream", (event) => {
      if (event.branchId !== branchId) return;
      if (event.type === "text") {
        textBufRef.current += event.text;
        scheduleFlush();
      } else if (event.type === "subagent") {
        subagentBufRef.current.push(event);
        scheduleFlush();
      } else if (event.type === "tool_start") {
        setStreaming((s) =>
          s
            ? {
                ...s,
                toolCalls: [
                  ...s.toolCalls,
                  { name: event.name, status: "running", argsPreview: liveArgsPreview(event.args) },
                ],
              }
            : s,
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
      subagentBufRef.current = [];
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, [branchId]);

  // Explicit `images` (retry/regenerate/edit resends) bypass the composer's
  // staged chips; without it the staged chips ride along and are consumed.
  const send = async (text: string, images?: MessageImage[]) => {
    const trimmed = text.trim();
    const imgs = images ?? pendingImages;
    if (!branchId || sending || (!trimmed && imgs.length === 0)) return;
    lastSentRef.current = trimmed;
    lastSentImagesRef.current = imgs;
    setErrorState(null);
    setSending(true);
    setPendingUser(trimmed);
    setPendingUserImages(imgs);
    if (images === undefined) setPendingImages([]);
    setStreaming({ text: "", toolCalls: [], subagentRuns: [] });
    try {
      await sendMessage.mutate({ branchId, message: trimmed, images: imgs.length ? imgs : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send message");
    } finally {
      setSending(false);
      setStreaming(null);
      setPendingUser(null);
      setPendingUserImages([]);
    }
  };

  const submitDraft = (value: string) => {
    setDraft("");
    setSkillPickerOpen(false);
    setSlashDismissed(false);
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

  const retryTurn = (turn: number, content: string, images?: MessageImage[]) => {
    editMessage
      .mutate({ branchId: branchId!, turn })
      .then(() => send(content, images ?? []))
      .catch(() => toast.error("Couldn't retry that message"));
  };

  const retryFailed = () => {
    if (!errorState) return;
    const { turn } = errorState;
    const text = lastSentRef.current;
    const images = lastSentImagesRef.current;
    setErrorState(null);
    if (turn >= 0) {
      editMessage
        .mutate({ branchId: branchId!, turn })
        .then(() => send(text, images))
        .catch(() => toast.error("Couldn't retry that message"));
    } else {
      void send(text, images);
    }
  };

  const regenerate = (precedingUserText: string, images?: MessageImage[]) => {
    undoTurn
      .mutate({ branchId: branchId! })
      .then(() => send(precedingUserText, images ?? []))
      .catch(() => toast.error("Couldn't regenerate that response"));
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  // Pins are branch-level context snippets — prompt assembly carries them
  // into every future turn on this branch.
  const pin = (text: string) => {
    addPin
      .mutate({ branchId: branchId!, text })
      .then(() => toast.success("Pinned — this stays in the branch's context"))
      .catch(() => toast.error("Couldn't pin that"));
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
    (pendingUser || pendingUserImages.length) && !(lastTurn?.role === "user" && lastTurn.content === pendingUser),
  );

  // With `paths` (drag-drop) the files upload directly; without, main opens
  // its picker.
  const uploadFiles = async (paths?: string[]) => {
    if (!branchId) return;
    try {
      const { created, skipped } = await window.ipc.invoke("artifact:upload", { branchId, paths });
      if (created.length) {
        invalidateQueries();
        toast.success(
          created.length === 1
            ? `Attached “${created[0].title}” — it's now in this branch's context`
            : `Attached ${created.length} files to this branch's context`,
        );
        for (const c of created) if (c.note) toast.info(`${c.title}: ${c.note}`);
      }
      for (const s of skipped) toast.error(`${s.filename}: ${s.reason}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't attach files");
    }
  };

  // ⌘U / Ctrl+U — the shortcut the attach menu advertises. Ref keeps the
  // listener stable while always calling the latest closure.
  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        void uploadFilesRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // "/tok" with no space yet — the token being autocompleted. A space ends
  // autocomplete (the command is already complete ahead of it).
  const slashToken = /^\/([\w-]*)$/.exec(draft)?.[1];
  const slashTyping = slashToken !== undefined && !slashDismissed;
  const skillOptions = useMemo(() => {
    if (skillPickerOpen) return enabledSkills;
    if (slashToken === undefined) return [];
    const q = slashToken.toLowerCase();
    return enabledSkills.filter((s) => s.name.toLowerCase().startsWith(q));
  }, [skillPickerOpen, slashToken, enabledSkills]);
  const slashOpen = (skillPickerOpen || slashTyping) && !sending;
  useEffect(() => {
    setSlashIndex(0);
  }, [slashToken, skillPickerOpen]);

  if (branches && !branch) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-md text-fg-subtle">This branch no longer exists.</p>
      </div>
    );
  }

  const reportStaged = (
    staged: MessageImage[],
    skipped: Array<{ filename: string; reason: string }>,
  ) => {
    if (staged.length) setPendingImages((prev) => [...prev, ...staged]);
    for (const s of skipped) toast.error(`${s.filename}: ${s.reason}`);
  };

  const handleAttachImages = async () => {
    if (!branchId) return;
    try {
      const { staged, skipped } = await window.ipc.invoke("image:stage", { branchId });
      reportStaged(staged, skipped);
      if (!staged.length && !skipped.length) toast("No images added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't attach images");
    }
  };

  // Pasted bitmaps and pathless drags (e.g. an image dragged off a web page)
  // have no filesystem path — ship the bytes to main for staging.
  const stageImageFiles = async (files: File[]) => {
    if (!branchId || !files.length) return;
    try {
      const images = await Promise.all(
        files.map(async (f) => ({
          filename: f.name || "pasted-image",
          dataBase64: arrayBufferToBase64(await f.arrayBuffer()),
        })),
      );
      const { staged, skipped } = await window.ipc.invoke("image:stage-data", { branchId, images });
      reportStaged(staged, skipped);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't attach images");
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void stageImageFiles(files);
  };

  // Dropped files route by kind: images stage as attachments (by path when
  // the OS provides one, by bytes otherwise), everything else goes down the
  // document-upload path with its own per-file skip reasons.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!branchId) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    const imagePaths: string[] = [];
    const docPaths: string[] = [];
    const pathless: File[] = [];
    for (const f of files) {
      const p = window.ipc.pathForFile(f);
      if (!p) {
        if (f.type.startsWith("image/")) pathless.push(f);
        continue;
      }
      if (f.type.startsWith("image/")) imagePaths.push(p);
      else docPaths.push(p);
    }
    if (pathless.length) void stageImageFiles(pathless);
    if (imagePaths.length) {
      window.ipc
        .invoke("image:stage", { branchId, paths: imagePaths })
        .then(({ staged, skipped }) => reportStaged(staged, skipped))
        .catch(() => toast.error("Couldn't attach images"));
    }
    if (docPaths.length) void uploadFiles(docPaths);
  };

  const applySkill = (name: string) => {
    // Typed mode replaces the /token; browse mode prefixes the current draft.
    setDraft((d) => (/^\/[\w-]*$/.test(d) ? `/${name} ` : `/${name} ${d}`));
    setSkillPickerOpen(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slashOpen) return;
    if (skillOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % skillOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + skillOptions.length) % skillOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySkill(skillOptions[Math.min(slashIndex, skillOptions.length - 1)]!.name);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setSkillPickerOpen(false);
      setSlashDismissed(true);
    }
  };

  // Hidden while a bare "/token" matches nothing — that draft is (probably)
  // just text, and Enter should send it as-is.
  const slashPopup = slashOpen && (skillOptions.length > 0 || skillPickerOpen) && (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-2 p-1.5 shadow-float">
      <p className="px-2.5 pb-1 pt-1 text-label-sm text-fg-subtle">Skills</p>
      {skillOptions.length === 0 ? (
        <p className="px-2.5 pb-1.5 text-body-sm text-fg-subtle">
          No skills installed yet — add them in{" "}
          <Link to="/settings/skills" className="text-fg underline underline-offset-2">
            Settings → Skills
          </Link>
          .
        </p>
      ) : (
        skillOptions.map((s, i) => (
          <button
            type="button"
            key={s.name}
            // Keep the textarea focused so keyboard nav survives a hover-click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applySkill(s.name)}
            onMouseEnter={() => setSlashIndex(i)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left",
              i === slashIndex && "bg-surface-3",
            )}
          >
            <LightningIcon size={14} className="shrink-0 text-fg-muted" />
            <span className="shrink-0 font-mono text-label-md text-fg">/{s.name}</span>
            {s.description && (
              <span className="min-w-0 flex-1 truncate text-body-sm text-fg-subtle">
                {s.description}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );

  const imageChips = pendingImages.length > 0 && (
    <div className="flex w-full flex-wrap gap-3 rounded-[20px] border border-line bg-surface-1 p-3 shadow-float">
      {pendingImages.map((img, i) => (
        <div key={img.blobPath} className="relative">
          <StagedImage blobPath={img.blobPath} filename={img.filename} />
          <button
            type="button"
            aria-label={`Remove ${img.filename}`}
            onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
            className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
          >
            <XIcon size={12} weight="bold" />
          </button>
        </div>
      ))}
    </div>
  );

  const composer = (
    <div className="relative flex w-full flex-col gap-2">
      {slashPopup}
      {imageChips}
    <Composer
      className="w-full"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        // Typing again revives a dismissed autocomplete and ends browse mode.
        setSlashDismissed(false);
        setSkillPickerOpen(false);
      }}
      onKeyDown={handleComposerKeyDown}
      onSubmit={submitDraft}
      onPaste={handlePaste}
      disabled={sending}
      textareaRef={composerInputRef}
      placeholder={editingTurn !== null ? "Edit message…" : "Ask anything…"}
      leading={
        <Menu>
          <MenuTrigger render={<ComposerButton aria-label="Attach" />}>
            <PaperclipIcon size={18} />
          </MenuTrigger>
          <MenuContent side="top" align="start" sideOffset={10}>
            <MenuItem onClick={() => void uploadFiles()}>
              <FileTextIcon /> Add files
              <MenuShortcut>
                <KbdGroup keys={["⌘", "U"]} />
              </MenuShortcut>
            </MenuItem>
            <MenuItem onClick={handleAttachImages}>
              <ImagesIcon /> Add photos
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                setSkillPickerOpen(true);
                requestAnimationFrame(() => composerInputRef.current?.focus());
              }}
            >
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
    </div>
  );

  const empty = turns.length === 0 && !streaming;

  if (empty) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-6 px-6"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="text-center">
          <h1 className="text-heading-md text-fg">{greetingLine(user?.name)}</h1>
          <p className="mt-1 text-body-md text-fg-muted">What shall we build today?</p>
        </div>
        <div className="w-full max-w-2xl">{composer}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-6 py-6">
            <MessageScrollerContent className="mx-auto w-full max-w-2xl">
              {turns.map((m, i) => {
                const isLastAssistant = m.role === "assistant" && i === turns.length - 1 && !streaming;
                const precedingUser = isLastAssistant ? turns[i - 1] : undefined;
                // Divider where inherited ancestry ends and this branch's own
                // conversation begins.
                const forkPoint = m.inherited && !turns[i + 1]?.inherited;
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id}>
                    <Message role={m.role as "user" | "assistant"}>
                      {m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0 && (
                        <ToolActivity
                          calls={m.toolCalls!.map((tc) => ({
                            name: tc.name,
                            status: tc.success ? "done" : "error",
                            argsPreview: tc.argsPreview,
                            // steps ?? []: rows persisted before the trail
                            // existed carry no steps — don't crash on them.
                            agents: tc.agents?.map((a) => ({ ...a, steps: a.steps ?? [] })),
                          }))}
                          onAgentClick={setAgentDetail}
                        />
                      )}
                      {m.images?.length ? (
                        <MessageImages images={m.images} onOpen={setViewerImage} />
                      ) : null}
                      {m.content || !m.images?.length ? (
                        <MessageContent>
                          {m.role === "user" ? (
                            <UserMessageBody text={m.content} skillNames={skillNames} />
                          ) : (
                            <Markdown text={m.content} />
                          )}
                        </MessageContent>
                      ) : null}
                      <MessageActions>
                        {m.inherited ? (
                          // Inherited rows belong to ancestor branches —
                          // turn-based mutations (edit/retry/delete) would hit
                          // the wrong branch, so they're read-only here.
                          <>
                            <MessageAction label="Copy" onClick={() => copy(m.content)}>
                              <CopyIcon />
                            </MessageAction>
                            <MessageTimestamp>{formatTime(m.timestamp)}</MessageTimestamp>
                            {m.model && <MessageModel>{m.model}</MessageModel>}
                          </>
                        ) : m.role === "user" ? (
                          <>
                            <MessageAction
                              label="Edit message"
                              onClick={() => {
                                setEditingTurn(m.turn);
                                setDraft(m.content);
                                // The turn's images become removable chips so
                                // the resend keeps (or drops) them explicitly.
                                setPendingImages(m.images ?? []);
                              }}
                            >
                              <PencilSimpleIcon />
                            </MessageAction>
                            <MessageAction label="Copy message" onClick={() => copy(m.content)}>
                              <CopyIcon />
                            </MessageAction>
                            <MessageAction label="Retry" onClick={() => retryTurn(m.turn, m.content, m.images)}>
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
                                onClick={() => regenerate(precedingUser.content, precedingUser.images)}
                              >
                                <ArrowsClockwiseIcon />
                              </MessageAction>
                            )}
                            <MessageAction
                              label="Branch from here"
                              onClick={() => setBranchingFromTurn(m.turn)}
                            >
                              <GitForkIcon />
                            </MessageAction>
                            <MessageAction
                              label="Pin to branch context"
                              onClick={() => pin(m.content)}
                            >
                              <PushPinIcon />
                            </MessageAction>
                            <MessageTimestamp>{formatTime(m.timestamp)}</MessageTimestamp>
                            {m.model && <MessageModel>{m.model}</MessageModel>}
                          </>
                        )}
                      </MessageActions>
                    </Message>
                    {forkPoint && (
                      <Marker rule className="my-4">
                        <MarkerIcon>
                          <GitForkIcon />
                        </MarkerIcon>
                        <MarkerContent>
                          Forked here{branch?.name ? (
                            <>
                              {" — "}
                              <span className="font-mono text-[12px]">{branch.name}</span> starts
                            </>
                          ) : null}
                        </MarkerContent>
                      </Marker>
                    )}
                  </MessageScrollerItem>
                );
              })}

              {showPendingUser && (
                <MessageScrollerItem messageId="__pending-user" className="[content-visibility:visible]">
                  <Message role="user">
                    {pendingUserImages.length > 0 && (
                      <MessageImages images={pendingUserImages} onOpen={setViewerImage} />
                    )}
                    {pendingUser ? (
                      <MessageContent>
                        <UserMessageBody text={pendingUser} skillNames={skillNames} />
                      </MessageContent>
                    ) : null}
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
                    {streaming.toolCalls.length > 0 && (
                      <ToolActivity
                        calls={attachLiveAgents(streaming.toolCalls, streaming.subagentRuns)}
                        onAgentClick={setAgentDetail}
                      />
                    )}
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
                // Drop the chips the edit staged from the original turn.
                setPendingImages([]);
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

      <ImageLightbox image={viewerImage} onClose={() => setViewerImage(null)} />

      <SubagentDetailDrawer
        // While the run is live, render the freshest state from the stream so
        // the open drawer updates as the agent works.
        run={
          (agentDetail?.runId &&
            streaming?.subagentRuns.find(
              (r) => r.runId === agentDetail.runId && r.agentId === agentDetail.agentId,
            )) ||
          agentDetail
        }
        onClose={() => setAgentDetail(null)}
      />

      <NameDialog
        open={branchingFromTurn !== null}
        onOpenChange={(open) => {
          if (!open) setBranchingFromTurn(null);
        }}
        title="Branch from here"
        description="Forks the conversation at this reply — everything up to it is inherited, everything after stays on this branch."
        placeholder="New branch name"
        submitLabel="Branch"
        onSubmit={async (name) => {
          const turn = branchingFromTurn!;
          try {
            const fork = await createBranch.mutate({
              name,
              model: branch?.model ?? "",
              parentId: branchId!,
              forkAtIndex: turn,
              chatId: branch?.chatId,
            });
            navigate(`/chats/${branch?.chatId}/branches/${fork.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create branch");
            throw err;
          }
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool activity — collapsible list of a turn's tool calls, same grammar as
// the "Explored 4 files" marker in the gallery. Rendered live while
// streaming and again (from the persisted message) once the turn lands, so
// what the assistant DID stays visible alongside what it said.
// ─────────────────────────────────────────────────────────────────────────────

/** What kind of work a tool name represents — drives the row's icon. */
function toolIcon(name: string): React.ComponentProps<typeof MarkerIcon>["children"] {
  if (/^(web_search|web_fetch|http_)/.test(name)) return <GlobeIcon />;
  if (/^(read_file|write_file|edit_file|apply_patch|list_files|glob|grep)/.test(name)) return <FileTextIcon />;
  if (/^(bash|terminal_)/.test(name)) return <TerminalWindowIcon />;
  if (/^(remember|recall_memories)/.test(name)) return <BrainIcon />;
  if (/^kb_/.test(name)) return <NotebookIcon />;
  if (/^(subagent|delegate)/.test(name)) return <TreeStructureIcon />;
  if (/^(todo_|think)/.test(name)) return <ListChecksIcon />;
  if (/^git/.test(name)) return <GitBranchIcon />;
  return <WrenchIcon />;
}

function ToolActivity({
  calls,
  onAgentClick,
}: {
  calls: ToolCallState[];
  onAgentClick?: (run: SubagentRun) => void;
}) {
  const running = calls.some((c) => c.status === "running");
  const failed = calls.filter((c) => c.status === "error").length;
  return (
    <Collapsible defaultOpen className="mb-1.5">
      <CollapsibleTrigger className="py-1">
        {running ? <Spinner size="sm" /> : <CheckIcon size={12} weight="bold" />}
        {counted(calls.length, "tool call")}
        {failed > 0 && <span className="text-danger-text">· {failed} failed</span>}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 pb-1.5 pl-1.5 pt-2.5">
          {calls.map((call, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Marker>
                <MarkerIcon className={call.status === "error" ? "text-danger-text" : undefined}>
                  {call.status === "running" ? <Spinner size="sm" /> : toolIcon(call.name)}
                </MarkerIcon>
                <MarkerContent className="flex min-w-0 items-baseline gap-2 font-mono text-[12px]">
                  <span className="shrink-0">{call.name}</span>
                  {call.argsPreview && (
                    <span className="min-w-0 truncate text-[11px] text-fg-subtle">
                      {call.argsPreview}
                    </span>
                  )}
                </MarkerContent>
                {call.status === "error" && (
                  <WarningCircleIcon size={14} className="shrink-0 text-danger-text" />
                )}
              </Marker>
              {call.agents?.map((agent) => (
                <SubagentRow
                  key={`${agent.runId ?? ""}:${agent.agentId}`}
                  run={agent}
                  onClick={onAgentClick}
                />
              ))}
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** Live elapsed-time ticker for a running agent. */
function Elapsed({ since }: { since: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatDuration(Date.now() - since)}</>;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** One delegated agent under its subagent/delegate call — click opens the
 * transcript drawer. Shows the current tool + elapsed time while running. */
function SubagentRow({ run, onClick }: { run: SubagentRun; onClick?: (run: SubagentRun) => void }) {
  const lastStep = run.steps[run.steps.length - 1];
  const currentTool =
    run.status === "running" && lastStep?.type === "tool" && lastStep.success === undefined
      ? lastStep.tool
      : undefined;
  return (
    <button
      type="button"
      onClick={() => onClick?.(run)}
      className="pressable group/agent ml-5 flex items-center gap-2 rounded-md border-l border-line py-1 pl-3 pr-2 text-left hover:bg-surface-2"
    >
      <span
        className={
          run.status === "failed" ? "flex shrink-0 text-danger-text" : "flex shrink-0 text-fg-subtle"
        }
      >
        {run.status === "running" ? (
          <Spinner size="sm" />
        ) : run.status === "failed" ? (
          <WarningCircleIcon size={14} />
        ) : (
          <TreeStructureIcon size={14} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted group-hover/agent:text-fg">
        {run.agentId}
      </span>
      {currentTool && (
        <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{currentTool}</span>
      )}
      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
        {run.status === "running" && run.startedAt ? (
          <Elapsed since={run.startedAt} />
        ) : run.durationMs !== undefined ? (
          formatDuration(run.durationMs)
        ) : null}
      </span>
      {run.model && (
        <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{run.model}</span>
      )}
    </button>
  );
}

/** One transcript step: a stretch of the agent's own text (markdown) or a
 * tool call with its args and outcome preview. */
function SubagentStepView({ step, active }: { step: SubagentRun["steps"][number]; active: boolean }) {
  if (step.type === "text") {
    return (
      <div className="text-body-sm">
        <Markdown text={step.text ?? ""} />
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={
            step.success === false ? "flex shrink-0 text-danger-text" : "flex shrink-0 text-fg-subtle"
          }
        >
          {active ? <Spinner size="sm" /> : toolIcon(step.tool ?? "")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted">
          {step.tool}
        </span>
        {step.success === false && (
          <WarningCircleIcon size={14} className="shrink-0 text-danger-text" />
        )}
      </div>
      {step.args && step.args !== "{}" && (
        <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{step.args}</div>
      )}
      {step.resultPreview && (
        <div className="mt-1 line-clamp-2 font-mono text-[11px] text-fg-subtle">
          → {step.resultPreview}
        </div>
      )}
    </div>
  );
}

/** The full transcript of one delegated agent — everything it writes and
 * every tool call, streamed live. A NON-MODAL drawer (no backdrop): the point
 * is watching the agent alongside the chat, not focusing into a modal. */
function SubagentDetailDrawer({
  run,
  onClose,
}: {
  run: SubagentRun | null;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Follow the transcript while the agent works (the drawer is a live view;
  // scrolling history mid-run is what the persisted record is for).
  useEffect(() => {
    const el = bodyRef.current;
    if (el && run?.status === "running") el.scrollTop = el.scrollHeight;
  }, [run]);

  return (
    <Drawer open={run !== null} onOpenChange={(open) => !open && onClose()} modal={false}>
      {run && (
        <DrawerContent showBackdrop={false}>
          <DrawerHeader className="border-b border-line">
            <DrawerTitle className="flex items-center gap-2.5">
              {run.status === "running" && <Spinner size="sm" />}
              <span className="min-w-0 truncate font-mono text-[15px]">{run.agentId}</span>
              {run.status === "failed" && (
                <span className="shrink-0 text-body-sm font-normal text-danger-text">failed</span>
              )}
            </DrawerTitle>
            <DrawerDescription className="flex items-center gap-2 font-mono text-[12px]">
              {run.model && <span>{run.model}</span>}
              <span>
                {run.status === "running" && run.startedAt ? (
                  <Elapsed since={run.startedAt} />
                ) : run.durationMs !== undefined ? (
                  formatDuration(run.durationMs)
                ) : null}
              </span>
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody ref={bodyRef} className="flex flex-col gap-3 py-4">
            {run.task && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Task</h4>
                <p className="whitespace-pre-wrap text-body-sm text-fg-muted">{run.task}</p>
              </section>
            )}
            {(run.steps.length > 0 || run.status === "running") && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">
                  Transcript
                </h4>
                <div className="flex flex-col gap-2">
                  {run.steps.map((step, i) => (
                    <SubagentStepView
                      key={i}
                      step={step}
                      active={
                        run.status === "running" &&
                        i === run.steps.length - 1 &&
                        step.type === "tool" &&
                        step.success === undefined
                      }
                    />
                  ))}
                  {run.status === "running" && <TypingDots />}
                </div>
              </section>
            )}
            {run.error && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Error</h4>
                <p className="whitespace-pre-wrap text-body-sm text-danger-text">{run.error}</p>
              </section>
            )}
            {/* The transcript already contains everything the agent wrote — a
                separate Result section only serves records persisted before
                transcripts existed. */}
            {run.result && !run.steps.some((s) => s.type === "text") && (
              <section>
                <h4 className="mb-1.5 text-label-sm uppercase tracking-wide text-fg-subtle">Result</h4>
                <Markdown text={run.result} />
              </section>
            )}
          </DrawerBody>
        </DrawerContent>
      )}
    </Drawer>
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
