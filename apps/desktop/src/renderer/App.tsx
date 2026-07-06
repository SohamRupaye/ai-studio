import { useTheme } from "./hooks/use-theme";
import { useModelsRefreshListener } from "./hooks/use-ipc-data";
import { AuthProvider } from "./components/auth-provider";
import { WorkspaceProvider } from "./components/workspace-provider";
import { UiPrefsProvider } from "./components/ui-prefs";
import { UiGallery } from "./components/ui-gallery";
import { Toaster } from "./components/ui/sonner";

// UI rebuild in progress — the IPC-backed provider tree and data hooks are
// preserved; the dev gallery stands in until real pages/routes land.
export default function App() {
  const { theme, setTheme } = useTheme();
  useModelsRefreshListener();

  const applied =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  return (
    <AuthProvider>
      <WorkspaceProvider>
        <UiPrefsProvider>
          <UiGallery
            theme={applied}
            onToggleTheme={() => setTheme(applied === "dark" ? "light" : "dark")}
          />
          <Toaster theme={applied} />
        </UiPrefsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
