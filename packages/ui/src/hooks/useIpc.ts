import { useEffect } from "react";
import type { IpcEventChannel, IpcEventPayload } from "@ai-studio/event-bus";

/**
 * Subscribe to a main-process push event and auto-cleanup on unmount.
 *
 * @example
 * useIpcEvent("chat:stream", (event) => {
 *   if (event.type === "text") appendText(event.text);
 * });
 */
export function useIpcEvent<C extends IpcEventChannel>(
  channel: C,
  handler: (payload: IpcEventPayload<C>) => void,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const off = window.ipc.on(channel, handler);
    return off;
  }, [channel, ...deps]);
}
