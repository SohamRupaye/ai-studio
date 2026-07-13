import { createContext, useContext, useState, useCallback } from "react";

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
