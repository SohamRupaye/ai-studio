import { contextBridge, ipcRenderer } from "electron";
import type {
  IpcInvokeMap,
  IpcEventMap,
  IpcInvokeChannel,
  IpcEventChannel,
  IpcInvokeRequest,
  IpcInvokeResponse,
  IpcEventPayload,
} from "@ai-studio/event-bus";

// Typed IPC bridge exposed as window.ipc in the renderer.

const ipc = {
  /**
   * Invoke a main-process handler and await the result.
   * Example: const branches = await window.ipc.invoke("branch:list", undefined)
   */
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    payload: IpcInvokeRequest<C>,
  ): Promise<IpcInvokeResponse<C>> {
    return ipcRenderer.invoke(channel, payload) as Promise<IpcInvokeResponse<C>>;
  },

  /**
   * Subscribe to a one-way push event from the main process.
   * Returns an unsubscribe function.
   * Example: const off = window.ipc.on("chat:stream", (event) => { ... })
   */
  on<C extends IpcEventChannel>(
    channel: C,
    handler: (payload: IpcEventPayload<C>) => void,
  ): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<C>) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("ipc", ipc);

// Make window.ipc typeable in the renderer without importing electron.
export type IpcBridge = typeof ipc;
