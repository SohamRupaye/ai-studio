import { ipcMain } from "electron";
import type { IpcInvokeChannel, IpcInvokeRequest, IpcInvokeResponse } from "@ai-studio/event-bus";

export function handle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (payload: IpcInvokeRequest<C>) => Promise<IpcInvokeResponse<C>> | IpcInvokeResponse<C>,
) {
  ipcMain.handle(channel, async (_event, payload: IpcInvokeRequest<C>) => handler(payload));
}
