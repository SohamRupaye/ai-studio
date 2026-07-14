// ─────────────────────────────────────────────────────────────────────────────
// Chat-finished notifications.
//
// The whole point: kick off a long turn, switch to another app, get pinged
// when the reply lands. Prefs live in localStorage (same store the Settings →
// Notifications controls bind to) and are read *fresh at fire time* — a stream
// can outlive a settings change, and we want the latest choice to win.
//
// Policy lives here; the actual OS notification is rendered by the main process
// (see main/ipc/notify.ts) so clicking it can pull the window back to front.
// ─────────────────────────────────────────────────────────────────────────────

/** off — never notify · unfocused — only when the window isn't focused (the
 * "I stepped away" case) · always — every finished turn. */
export type NotifyMode = "off" | "unfocused" | "always";

const MODE_KEY = "ai-studio:notify-mode";
const SOUND_KEY = "ai-studio:notify-sound";

export function getNotifyMode(): NotifyMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === "off" || v === "always" ? v : "unfocused";
}

export function setNotifyModePref(mode: NotifyMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function getNotifySound(): boolean {
  // Default on; only an explicit "off" silences it.
  return localStorage.getItem(SOUND_KEY) !== "off";
}

export function setNotifySoundPref(on: boolean): void {
  localStorage.setItem(SOUND_KEY, on ? "on" : "off");
}

/** First non-empty line of the reply, stripped of markdown noise and clamped —
 * enough to recognise the answer without turning into a wall of text. */
function snippet(text: string): string {
  const line = text
    .trim()
    .split("\n")
    .find((l) => l.trim().length);
  const clean = (line ?? "").replace(/[#*`_>~[\]]/g, "").trim();
  if (!clean) return "Your reply is ready.";
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
}

/**
 * Fire a "reply ready" notification, if prefs + focus allow. Safe to call on
 * every finished turn — it self-gates and no-ops when it shouldn't fire.
 */
export function notifyChatDone(opts: {
  /** Chat/branch name for the title, when known. */
  name?: string;
  /** The finished reply — its first line becomes the body. */
  text: string;
  branchId?: string;
  chatId?: string;
}): void {
  const mode = getNotifyMode();
  if (mode === "off") return;
  if (mode === "unfocused" && document.hasFocus()) return;

  // Fire-and-forget — a failed OS notification should never surface an error.
  void window.ipc
    .invoke("notify:show", {
      title: opts.name ? `${opts.name} — reply ready` : "Reply ready",
      body: snippet(opts.text),
      silent: !getNotifySound(),
      branchId: opts.branchId,
      chatId: opts.chatId,
    })
    .catch(() => {});
}
