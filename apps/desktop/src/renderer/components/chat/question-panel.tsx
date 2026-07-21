import { KeyReturnIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Button, Kbd } from "../ui";
import { cn } from "../../lib/utils";

export interface PendingQuestion {
  id: string;
  text: string;
  /** Pre-split by main ("a,b" → ["a","b"]); empty = free-text answer. */
  options: string[];
}

/**
 * The question text of a persisted/live `question` tool call. args is the
 * detail string: pretty JSON when the model sent {text, options}, or the
 * bare question when it sent text alone (single-string-arg calls store the
 * string itself). summary is the truncating fallback for old rows.
 */
export function questionCallText(tc: { summary?: string; args?: string }): string {
  const a = tc.args;
  if (a) {
    if (a.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(a);
        const text = (parsed as { text?: unknown })?.text;
        if (typeof text === "string") return text;
      } catch {
        // truncated JSON — fall through to summary
      }
    } else {
      return a;
    }
  }
  return tc.summary ?? "";
}

/**
 * An answered question in the transcript: the exchange rendered as content
 * (question + the user's answer), not as a mono tool row — the user typed
 * that answer; it's part of the conversation, not plumbing. The live panel
 * is the pending state; this block is what it settles into.
 */
export function QuestionExchange({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="my-1 rounded-lg border border-line px-4 py-3">
      <p className="text-body-md font-medium text-fg">{question}</p>
      {answer && <p className="mt-1 whitespace-pre-wrap text-body-md text-fg-muted">{answer}</p>}
    </div>
  );
}

/**
 * The `question` tool's answer surface: a panel attached above the composer
 * (same popup language as the slash autocomplete — surface-2, shadow-float,
 * 16−6→10 radius), not a standalone card. The composer stays live underneath
 * as the free-text path ("Or reply directly…"), so answering is the same
 * gesture as chatting. Keyboard driving (↑/↓, Enter, 1–9, Esc = skip) lives
 * in chat-page's composer onKeyDown — the textarea keeps focus throughout;
 * rows preventDefault on mousedown so a hover-click doesn't steal it.
 * Picking an option submits immediately (no separate Submit step).
 */
export function QuestionPanel({
  question,
  highlightIndex,
  onHighlight,
  onPick,
  onSkip,
  onFreeText,
}: {
  question: PendingQuestion;
  highlightIndex: number;
  onHighlight: (i: number) => void;
  onPick: (option: string) => void;
  onSkip: () => void;
  onFreeText: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-1.5 shadow-float">
      <div className="flex items-start gap-2 px-2.5 pb-1.5 pt-2">
        <p className="min-w-0 flex-1 text-label-lg text-fg">{question.text}</p>
        <button
          type="button"
          aria-label="Skip question"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSkip}
          className="pressable -mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-surface-3 hover:text-fg"
        >
          <XIcon size={14} />
        </button>
      </div>
      {question.options.map((opt, i) => (
        <button
          type="button"
          key={i}
          // Keep the composer textarea focused so keyboard nav survives a
          // hover-click (same trick as the slash popup).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(opt)}
          onMouseEnter={() => onHighlight(i)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
            i === highlightIndex && "bg-surface-3",
          )}
        >
          <Kbd>{i + 1}</Kbd>
          <span className="min-w-0 flex-1 truncate text-body-md text-fg">{opt}</span>
          {i === highlightIndex && (
            <KeyReturnIcon size={14} className="shrink-0 text-fg-subtle" />
          )}
        </button>
      ))}
      <div className="mt-0.5 flex items-center gap-2.5 px-2.5 py-1">
        {question.options.length > 0 ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onFreeText}
            className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left text-fg-subtle transition-colors hover:text-fg"
          >
            <PencilSimpleIcon size={14} className="shrink-0" />
            <span className="text-body-md">Something else</span>
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-fg-subtle">
            <PencilSimpleIcon size={14} className="shrink-0" />
            <span className="text-body-md">Type your answer below</span>
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={onSkip}>
          Skip
        </Button>
      </div>
    </div>
  );
}
