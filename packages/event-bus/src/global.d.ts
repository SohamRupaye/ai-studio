import type { IpcInvokeChannel, IpcEventChannel, IpcInvokeRequest, IpcInvokeResponse, IpcEventPayload } from "./index.js";

// Augment the browser Window with the typed IPC bridge exposed by the preload.
// The concrete implementation is in apps/desktop/src/preload/index.ts.
declare global {
  interface Window {
    ipc: {
      invoke<C extends IpcInvokeChannel>(
        channel: C,
        payload: IpcInvokeRequest<C>,
      ): Promise<IpcInvokeResponse<C>>;

      on<C extends IpcEventChannel>(
        channel: C,
        handler: (payload: IpcEventPayload<C>) => void,
      ): () => void;
    };
  }
}

export {};
