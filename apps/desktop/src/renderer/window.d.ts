// Augment the Window interface with the typed IPC bridge exposed by the preload.
import type { IpcBridge } from "../preload/index.js";

declare global {
  interface Window {
    ipc: IpcBridge;
  }
}

export {};
