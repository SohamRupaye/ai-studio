import { handle } from "./handle.js";
import { mainWindow } from "../state.js";

export function registerWindowHandlers() {
  // ── Window ──────────────────────────────────────────────────────────────────

  handle("window:is-fullscreen", () => mainWindow?.isFullScreen() ?? false);
}
