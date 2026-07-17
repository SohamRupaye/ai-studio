/**
 * Automations scheduler — fires scheduled agent turns onto their branches.
 *
 * One self-rescheduling setTimeout (the repo idiom — see the classifier
 * queue) armed to the nearest enabled next_run_at, capped at a 60-minute
 * re-check so long sleeps survive clock drift and laptop suspends. Due
 * automations run SEQUENTIALLY — one agent turn at a time — each on its own
 * AbortController so a scheduled run never touches the chat:send module
 * controller (a user's in-flight turn and an automation can't cancel each
 * other). Local-first constraint, stated in the settings UI: automations
 * only fire while the app is running; anything missed while closed fires
 * once on the next launch (catch-up, not backfill).
 */
import { Cron } from "croner";
import type { Automation } from "@squirl/shared";
import { mainWindow, store } from "./state.js";
import { executeTurn, type ExtendedAbortController } from "./ipc/chat.js";

/** Widest the timer sleeps before re-checking (also the reconcile cadence). */
const MAX_ARM_MS = 60 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

/** Next fire time for a cron expression, or null if it never fires. */
export function nextRunTime(schedule: string, from?: Date): number | null {
  const next = new Cron(schedule).nextRun(from ?? new Date());
  return next ? next.getTime() : null;
}

/** Human-readable validation error for a cron expression, or null if valid. */
export function scheduleError(schedule: string): string | null {
  try {
    if (nextRunTime(schedule) === null) return "That schedule never fires.";
    return null;
  } catch (e) {
    return `Invalid cron expression: ${(e as Error).message}`;
  }
}

/** Boot the scheduler. Call after the window exists — a turn with no window
 * to stream to is skipped, and skipping a catch-up run would lose it. */
export function startAutomationScheduler() {
  // Backfill next_run_at for rows that lost it (or predate a schedule edit).
  for (const a of store.listAutomations({ enabledOnly: true })) {
    if (a.nextRunAt == null) {
      try { store.setAutomationNextRun(a.id, nextRunTime(a.schedule)); }
      catch { store.setAutomationEnabled(a.id, false); }
    }
  }
  void tick();
}

/** Re-arm the timer (CRUD calls this after any schedule change). */
export function rescheduleAutomations() {
  armTimer();
}

function armTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
  const enabled = store.listAutomations({ enabledOnly: true }).filter((a) => a.nextRunAt != null);
  if (!enabled.length) return;
  const soonest = Math.min(...enabled.map((a) => a.nextRunAt!));
  const delay = Math.min(Math.max(soonest - Date.now(), 0), MAX_ARM_MS);
  timer = setTimeout(() => { timer = null; void tick(); }, delay);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = store
      .listAutomations({ enabledOnly: true })
      .filter((a) => a.nextRunAt != null && a.nextRunAt <= Date.now());
    for (const a of due) {
      await runAutomation(a);
    }
  } finally {
    ticking = false;
    armTimer();
  }
}

async function runAutomation(a: Automation) {
  // No window yet (booting) — leave next_run_at in the past; the next tick
  // (or startup) retries rather than silently swallowing the run.
  if (!mainWindow) return;
  // Target branch is gone — disable rather than error forever.
  if (!store.getBranch(a.branchId)) {
    store.setAutomationEnabled(a.id, false);
    store.recordAutomationRun(a.id, "error", null);
    mainWindow?.webContents.send("automations:changed", undefined);
    return;
  }
  let status: "ok" | "error" = "ok";
  try {
    const controller: ExtendedAbortController = new AbortController();
    await executeTurn({ branchId: a.branchId, message: a.task, controller });
  } catch (e) {
    status = "error";
    console.error(`[automation] "${a.name}" failed:`, (e as Error)?.message ?? e);
  }
  let next: number | null = null;
  try { next = nextRunTime(a.schedule); } catch { /* invalid after edit — stops */ }
  store.recordAutomationRun(a.id, status, next);
  mainWindow?.webContents.send("automations:changed", undefined);
}
