/**
 * question tool → interactive card. Mirrors approvals.ts: the tool call
 * blocks inside the agent loop until the user answers on the card (or the
 * 5-minute timeout / a turn abort resolves it with a no-answer note the
 * model can act on). Unlike approvals there is no policy here — every
 * question reaches the user; the model is told to use the tool sparingly.
 */
import { randomUUID } from "node:crypto";
import { mainWindow, activeBranchId } from "./state.js";

const QUESTION_TIMEOUT_MS = 5 * 60_000;
const NO_ANSWER = "(The user didn't answer. Proceed with your best judgment, or finish the turn and ask in your reply.)";

interface PendingQuestion {
  branchId: string;
  resolve: (answer: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingQuestion>();

// The branch of the turn currently executing — set by executeTurn so
// questions raised by subagents land on the right page (same pattern as
// approvals' turn branch).
let turnBranchId: string | null = null;
export function setQuestionTurnBranch(branchId: string | null) {
  turnBranchId = branchId;
}

/** Ask the user the question tool's question; resolves with their answer. */
export async function requestQuestion(input: { text: string; options: string }): Promise<string> {
  if (!mainWindow) return NO_ANSWER;
  const branchId = turnBranchId ?? activeBranchId;
  const id = randomUUID();
  const options = input.options
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => finishQuestion(id, NO_ANSWER), QUESTION_TIMEOUT_MS);
    pending.set(id, { branchId, resolve, timer });
    mainWindow?.webContents.send("chat:stream", {
      type: "question_request",
      branchId,
      id,
      text: input.text,
      options,
    });
  });
}

/** Resolve a pending question (renderer answer, timeout, or abort). */
export function finishQuestion(id: string, answer: string) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  // Clears the card on every resolution path the renderer didn't initiate
  // (timeout, turn abort) — harmless echo when it did.
  mainWindow?.webContents.send("chat:stream", { type: "question_resolved", branchId: entry.branchId, id });
  entry.resolve(answer);
}

/** Resolve everything pending — called when a turn is aborted or superseded. */
export function cancelPendingQuestions() {
  for (const id of [...pending.keys()]) finishQuestion(id, NO_ANSWER);
}
