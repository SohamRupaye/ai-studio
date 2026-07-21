import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CopyIcon,
  CubeIcon,
  FileTextIcon,
  GitForkIcon,
  ImagesIcon,
  LightningIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PushPinIcon,
  StopIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { MessageImage, SubagentStreamEvent } from "@squirl/shared";
import { applySubagentEvent, newSubagentRecord, toolCallSummary, toolCallArgsDetail, toolCallResultDetail } from "@squirl/shared";
import { cn } from "../lib/utils";
import { notifyChatDone } from "../lib/notify";
import { invalidateQueries, useBranches, useMessages, useMutation, useSkills, useUser } from "../hooks/use-ipc-data";
import { Button } from "./ui/button";
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
import {
  ImageLightbox,
  MessageImages,
  StagedImage,
  ThinkingBlock,
  TypingDots,
  UserMessageBody,
  arrayBufferToBase64,
  formatTime,
  greetingLine,
} from "./chat/message-parts";
import { ApprovalCard } from "./chat/approval-card";
import type { PendingApproval } from "./chat/approval-card";
import { QuestionExchange, QuestionPanel, questionCallText } from "./chat/question-panel";
import type { PendingQuestion } from "./chat/question-panel";
import { SubagentDetailDrawer } from "./chat/subagents";
import { ToolActivity, attachLiveAgents } from "./chat/tool-activity";
import type { SubagentRun, ToolCallState } from "./chat/types";

// ─────────────────────────────────────────────────────────────────────────────
// Chat / branch page — the composer + message scroller composed against real
// IPC: chat:send / chat:stream (text deltas, tool activity, done, error),
// message:edit/delete/undo for the edit-and-resend / retry / regenerate
// flows. Assistant rows also expose "branch from here" (branch:create with
// forkAtIndex = that turn — git semantics, fork mid-history) and "pin"
// (branch:pin-add; pins feed the branch's context assembly).
// ─────────────────────────────────────────────────────────────────────────────

interface StreamState {
  text: string;
  /** Model reasoning streamed so far this turn (thinking-capable providers). */
  thinking: string;
  toolCalls: ToolCallState[];
  /** Flat, arrival-ordered agent runs for this turn — grouped by runId and
   * matched to subagent/delegate tool calls in order at render time. */
  subagentRuns: SubagentRun[];
}

interface ErrorState {
  turn: number;
  message: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

export function ChatPage() {
  const { branchId, chatId } = useParams();
  const navigate = useNavigate();
  const { data: branches } = useBranches();
  const branch = branches?.find((b) => b.id === branchId);
  // Snapshot of what a finished-turn notification needs, refreshed every
  // render so the stream's `done` handler (created once per branch) reads the
  // live name instead of whatever was loaded when its effect first ran.
  const notifyInfoRef = useRef<{ branchId?: string; chatId?: string; name?: string }>({});
  notifyInfoRef.current = { branchId, chatId, name: branch?.name };
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
  // A side-effecting tool call waiting on the user (main blocks the turn).
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
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
  // Thinking deltas are per-token like text — same frame-batched flush.
  const thinkingBufRef = useRef("");
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
      const thinkingChunk = thinkingBufRef.current;
      const subEvents = subagentBufRef.current;
      if (!chunk && !thinkingChunk && !subEvents.length) return;
      textBufRef.current = "";
      thinkingBufRef.current = "";
      subagentBufRef.current = [];
      setStreaming((s) => {
        if (!s) return s;
        let next = s;
        if (chunk) next = { ...next, text: next.text + chunk };
        if (thinkingChunk) next = { ...next, thinking: next.thinking + thinkingChunk };
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
      } else if (event.type === "thinking") {
        thinkingBufRef.current += event.text;
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
                  {
                    name: event.name,
                    status: "running",
                    summary: toolCallSummary(event.name, event.args),
                    args: toolCallArgsDetail(event.name, event.args),
                  },
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
              toolCalls[i] = {
                ...toolCalls[i]!,
                status: event.success ? "done" : "error",
                result: toolCallResultDetail(event.result),
              };
              break;
            }
          }
          return { ...s, toolCalls };
        });
      } else if (event.type === "approval_request") {
        setPendingApproval({ id: event.id, title: event.title, detail: event.detail });
      } else if (event.type === "approval_resolved") {
        // Fires on every resolution path (decision, timeout, abort).
        setPendingApproval((p) => (p && p.id === event.id ? null : p));
      } else if (event.type === "question_request") {
        setPendingQuestion({ id: event.id, text: event.text, options: event.options });
      } else if (event.type === "question_resolved") {
        // Fires on every resolution path (answer, skip, timeout, abort).
        setPendingQuestion((q) => (q && q.id === event.id ? null : q));
      } else if (event.type === "done") {
        // done carries the authoritative full text — drop anything buffered.
        textBufRef.current = "";
        thinkingBufRef.current = "";
        setPendingApproval(null);
        setPendingQuestion(null);
        if (flushFrameRef.current !== null) {
          cancelAnimationFrame(flushFrameRef.current);
          flushFrameRef.current = null;
        }
        setStreaming((s) => (s ? { ...s, text: event.text } : s));
        // Ping the OS if the user stepped away — the whole reason someone
        // kicks off a long turn and switches apps. Self-gates on prefs + focus.
        notifyChatDone({
          name: notifyInfoRef.current.name,
          text: event.text,
          branchId: notifyInfoRef.current.branchId,
          chatId: notifyInfoRef.current.chatId,
        });
        // This mount may not be the one that called send() (e.g. the user
        // navigated away and back while it was still running) — refetch
        // unconditionally so the persisted reply shows up either way.
        invalidateQueries();
      } else if (event.type === "error") {
        setPendingApproval(null);
        setPendingQuestion(null);
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
      thinkingBufRef.current = "";
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
    setStreaming({ text: "", thinking: "", toolCalls: [], subagentRuns: [] });
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

  // Answer the question tool through the composer surface — picked option,
  // typed reply, or skip all resolve the same pending tool call in main.
  const answerQuestion = (id: string, answer: string) => {
    // The question_resolved stream event clears the panel — no local unmount.
    window.ipc
      .invoke("chat:question-answer", { id, answer })
      .catch(() => toast.error("Couldn't send the answer"));
  };
  const skipQuestion = (id: string) =>
    answerQuestion(id, "(The user skipped the question — proceed with your best judgment.)");

  const submitDraft = (value: string) => {
    // A pending question owns the composer: the draft is the free-text
    // answer ("Or reply directly…"), not a new chat message — sending a new
    // message here would abort the very turn that's asking.
    if (pendingQuestion) {
      const trimmed = value.trim();
      if (!trimmed) return;
      setDraft("");
      answerQuestion(pendingQuestion.id, trimmed);
      return;
    }
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

  // A new question resets the highlight and pulls focus into the composer so
  // ↑/↓/Enter/typing answer it without a click.
  const pendingQuestionId = pendingQuestion?.id;
  useEffect(() => {
    if (!pendingQuestionId) return;
    setQuestionIndex(0);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [pendingQuestionId]);

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
    // Question panel drives first (it can't co-occur with the slash popup —
    // that one is gated on !sending). Keys act on the panel only while the
    // draft is empty enough that they can't be part of a typed answer.
    if (pendingQuestion && pendingQuestion.options.length > 0) {
      const opts = pendingQuestion.options;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setQuestionIndex((i) => (i + 1) % opts.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setQuestionIndex((i) => (i - 1 + opts.length) % opts.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && draft.trim() === "") {
        e.preventDefault();
        answerQuestion(pendingQuestion.id, opts[Math.min(questionIndex, opts.length - 1)]!);
        return;
      }
      if (draft === "" && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < opts.length) {
          e.preventDefault();
          answerQuestion(pendingQuestion.id, opts[idx]!);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        skipQuestion(pendingQuestion.id);
        return;
      }
    }
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
      {pendingQuestion && (
        <QuestionPanel
          key={pendingQuestion.id}
          question={pendingQuestion}
          highlightIndex={questionIndex}
          onHighlight={setQuestionIndex}
          onPick={(opt) => answerQuestion(pendingQuestion.id, opt)}
          onSkip={() => skipQuestion(pendingQuestion.id)}
          onFreeText={() => composerInputRef.current?.focus()}
        />
      )}
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
      // A pending question re-enables the composer mid-turn — it's the
      // free-text answer path while the turn is blocked on the tool call.
      disabled={sending && !pendingQuestion}
      textareaRef={composerInputRef}
      placeholder={
        pendingQuestion ? "Or reply directly…" : editingTurn !== null ? "Edit message…" : "Ask anything…"
      }
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
      {pendingQuestion && pendingQuestion.options.length > 0 && (
        <p className="text-center text-label-sm text-fg-subtle">
          ↑↓ to navigate · Enter to select · or type below
        </p>
      )}
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
                // question calls render as conversation content (the Q&A
                // exchange block), not as tool rows — split them out.
                const toolCalls = m.role === "assistant" ? (m.toolCalls ?? []) : [];
                const questionCalls = toolCalls.filter((tc) => tc.name === "question");
                const activityCalls = toolCalls.filter((tc) => tc.name !== "question");
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id}>
                    <Message role={m.role as "user" | "assistant"}>
                      {m.role === "assistant" && m.thinking && <ThinkingBlock text={m.thinking} />}
                      {activityCalls.length > 0 && (
                        <ToolActivity
                          calls={activityCalls.map((tc) => ({
                            name: tc.name,
                            status: tc.success ? "done" : "error",
                            // Rows persisted before summaries existed fall
                            // back to the stored trail preview.
                            summary: tc.summary ?? tc.argsPreview,
                            args: tc.args,
                            result: tc.result ?? tc.resultPreview,
                            // steps ?? []: rows persisted before the trail
                            // existed carry no steps — don't crash on them.
                            agents: tc.agents?.map((a) => ({ ...a, steps: a.steps ?? [] })),
                          }))}
                          onAgentClick={setAgentDetail}
                        />
                      )}
                      {questionCalls.map((tc, qi) => (
                        <QuestionExchange
                          key={qi}
                          question={questionCallText(tc)}
                          answer={tc.result ?? tc.resultPreview ?? ""}
                        />
                      ))}
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
                    {streaming.thinking && (
                      <ThinkingBlock
                        text={streaming.thinking}
                        // Follow the reasoning live until the answer starts,
                        // then get out of its way.
                        live={!streaming.text}
                      />
                    )}
                    {streaming.toolCalls.some((tc) => tc.name !== "question") && (
                      <ToolActivity
                        calls={attachLiveAgents(
                          streaming.toolCalls.filter((tc) => tc.name !== "question"),
                          streaming.subagentRuns,
                        )}
                        onAgentClick={setAgentDetail}
                      />
                    )}
                    {streaming.toolCalls
                      // Answered questions become exchange blocks live; a
                      // pending one is represented by the panel below.
                      .filter((tc) => tc.name === "question" && tc.result)
                      .map((tc, qi) => (
                        <QuestionExchange
                          key={qi}
                          question={questionCallText(tc)}
                          answer={tc.result!}
                        />
                      ))}
                    {streaming.text ? (
                      <MessageContent>
                        <Markdown text={streaming.text} />
                      </MessageContent>
                    ) : streaming.toolCalls.length === 0 && !streaming.thinking ? (
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
        {pendingApproval && <ApprovalCard key={pendingApproval.id} approval={pendingApproval} />}
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
