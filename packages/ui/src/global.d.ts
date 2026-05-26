import type { IpcBridge } from "../../apps/desktop/src/preload/index";

declare global {
  interface Window {
    ipc: IpcBridge;
  }
}
