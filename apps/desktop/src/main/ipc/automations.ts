import { handle } from "./handle.js";
import { mainWindow, store } from "../state.js";
import { nextRunTime, rescheduleAutomations } from "../scheduler.js";

export function registerAutomationHandlers() {
  handle("automation:list", () => store.listAutomations());

  handle("automation:toggle", ({ id, enabled }) => {
    store.setAutomationEnabled(id, enabled);
    // Re-enabling recomputes from now — a stale past next_run_at must not
    // fire a burst of catch-up turns the moment the switch flips.
    if (enabled) {
      const a = store.getAutomation(id);
      if (a) {
        try { store.setAutomationNextRun(id, nextRunTime(a.schedule)); }
        catch { store.setAutomationEnabled(id, false); }
      }
    }
    rescheduleAutomations();
    mainWindow?.webContents.send("automations:changed", undefined);
  });

  handle("automation:delete", ({ id }) => {
    store.deleteAutomation(id);
    rescheduleAutomations();
    mainWindow?.webContents.send("automations:changed", undefined);
  });
}
