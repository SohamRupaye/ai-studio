import { Notification } from "electron";
import { handle } from "./handle.js";
import { mainWindow } from "../state.js";

// ─────────────────────────────────────────────────────────────────────────────
// Native notifications — the renderer owns the *policy* (prefs + focus state
// live there); this just renders what it's told and, on click, pulls the
// window back to the front and tells the renderer which chat to open.
// ─────────────────────────────────────────────────────────────────────────────

export function registerNotifyHandlers() {
  handle("notify:show", ({ title, body, silent, branchId, chatId }) => {
    if (!Notification.isSupported()) return;

    const notification = new Notification({ title, body, silent: silent ?? false });
    notification.on("click", () => {
      const win = mainWindow;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send("notify:activated", { branchId, chatId });
    });
    notification.show();
  });
}
