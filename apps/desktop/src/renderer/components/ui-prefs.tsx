import { createContext, useContext, useState, useCallback } from "react";
import {
  getNotifyMode,
  getNotifySound,
  setNotifyModePref,
  setNotifySoundPref,
  type NotifyMode,
} from "../lib/notify";

interface UiPrefsValue {
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** Whether tool-call rows in the transcript expand to show the call's
   * input/output detail. Settings → General toggle; on by default. */
  toolCallDetail: boolean;
  setToolCallDetail: (show: boolean) => void;
  /** When to raise a native notification as a chat's reply finishes. */
  notifyMode: NotifyMode;
  setNotifyMode: (mode: NotifyMode) => void;
  /** Whether the finished-reply notification plays the system sound. */
  notifySound: boolean;
  setNotifySound: (on: boolean) => void;
}

const UiPrefsContext = createContext<UiPrefsValue | null>(null);

const RIGHT_KEY = "ai-studio:right-panel";
const SIDEBAR_KEY = "ai-studio:sidebar";
const TOOL_DETAIL_KEY = "ai-studio:tool-call-detail";

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [rightPanelOpen, setOpen] = useState<boolean>(
    () => localStorage.getItem(RIGHT_KEY) !== "closed",
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_KEY) !== "closed",
  );
  const [toolCallDetail, setToolCallDetailState] = useState<boolean>(
    () => localStorage.getItem(TOOL_DETAIL_KEY) !== "off",
  );
  const [notifyMode, setNotifyModeState] = useState<NotifyMode>(() => getNotifyMode());
  const [notifySound, setNotifySoundState] = useState<boolean>(() => getNotifySound());

  const setRightPanelOpen = useCallback((open: boolean) => {
    setOpen(open);
    localStorage.setItem(RIGHT_KEY, open ? "open" : "closed");
  }, []);

  const toggleRightPanel = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(RIGHT_KEY, next ? "open" : "closed");
      return next;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed");
      return next;
    });
  }, []);

  const setToolCallDetail = useCallback((show: boolean) => {
    setToolCallDetailState(show);
    localStorage.setItem(TOOL_DETAIL_KEY, show ? "on" : "off");
  }, []);

  const setNotifyMode = useCallback((mode: NotifyMode) => {
    setNotifyModeState(mode);
    setNotifyModePref(mode);
  }, []);

  const setNotifySound = useCallback((on: boolean) => {
    setNotifySoundState(on);
    setNotifySoundPref(on);
  }, []);

  return (
    <UiPrefsContext.Provider
      value={{
        rightPanelOpen,
        toggleRightPanel,
        setRightPanelOpen,
        sidebarOpen,
        toggleSidebar,
        toolCallDetail,
        setToolCallDetail,
        notifyMode,
        setNotifyMode,
        notifySound,
        setNotifySound,
      }}
    >
      {children}
    </UiPrefsContext.Provider>
  );
}

export function useUiPrefs(): UiPrefsValue {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error("useUiPrefs must be used within <UiPrefsProvider>");
  return ctx;
}
