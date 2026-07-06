import { createContext, useContext, useState, useCallback } from "react";

interface UiPrefsValue {
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const UiPrefsContext = createContext<UiPrefsValue | null>(null);

const RIGHT_KEY = "ai-studio:right-panel";
const SIDEBAR_KEY = "ai-studio:sidebar";

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [rightPanelOpen, setOpen] = useState<boolean>(
    () => localStorage.getItem(RIGHT_KEY) !== "closed",
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_KEY) !== "closed",
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

  return (
    <UiPrefsContext.Provider
      value={{ rightPanelOpen, toggleRightPanel, setRightPanelOpen, sidebarOpen, toggleSidebar }}
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
