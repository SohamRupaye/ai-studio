import { createContext, useContext, useState, useCallback } from "react";

interface UiPrefsValue {
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
}

const UiPrefsContext = createContext<UiPrefsValue | null>(null);

const KEY = "ai-studio:right-panel";

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [rightPanelOpen, setOpen] = useState<boolean>(
    () => localStorage.getItem(KEY) !== "closed",
  );

  const setRightPanelOpen = useCallback((open: boolean) => {
    setOpen(open);
    localStorage.setItem(KEY, open ? "open" : "closed");
  }, []);

  const toggleRightPanel = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(KEY, next ? "open" : "closed");
      return next;
    });
  }, []);

  return (
    <UiPrefsContext.Provider value={{ rightPanelOpen, toggleRightPanel, setRightPanelOpen }}>
      {children}
    </UiPrefsContext.Provider>
  );
}

export function useUiPrefs(): UiPrefsValue {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error("useUiPrefs must be used within <UiPrefsProvider>");
  return ctx;
}
