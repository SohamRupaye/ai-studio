import { Navigate, Route, Routes } from "react-router-dom";
import { useTheme } from "./hooks/use-theme";
import { useModelsRefreshListener } from "./hooks/use-ipc-data";
import { AuthProvider } from "./components/auth-provider";
import { WorkspaceProvider } from "./components/workspace-provider";
import { UiPrefsProvider } from "./components/ui-prefs";
import { AppShell } from "./components/app-shell";
import { UiGallery } from "./components/ui-gallery";
import { Toaster } from "./components/ui/sonner";

// Stand-in for pages that haven't been built yet — replaced route by route as
// real pages land (chat page is next).
function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-heading-sm text-fg-subtle">{title}</p>
    </div>
  );
}

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
          <Routes>
            {/* Dev scratchpad — full-window, outside the shell. Delete once
                every real page exists. */}
            <Route
              path="/gallery"
              element={
                <UiGallery
                  theme={applied}
                  onToggleTheme={() => setTheme(applied === "dark" ? "light" : "dark")}
                />
              }
            />

            <Route element={<AppShell />}>
              <Route index element={<Placeholder title="Home" />} />
              <Route path="/knowledge-base" element={<Placeholder title="Knowledge base" />} />
              <Route path="/graph" element={<Placeholder title="Knowledge graph" />} />
              <Route path="/spaces/:spaceId/memories" element={<Placeholder title="Memories" />} />
              <Route path="/spaces/:spaceId/artifacts" element={<Placeholder title="Artifacts" />} />
              <Route path="/chats/:chatId" element={<Placeholder title="Chat" />} />
              <Route
                path="/chats/:chatId/branches/:branchId"
                element={<Placeholder title="Branch" />}
              />
              <Route path="/branches/compare" element={<Placeholder title="Compare branches" />} />
              <Route path="/costs" element={<Placeholder title="Costs" />} />
              <Route path="/settings" element={<Placeholder title="Settings" />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster theme={applied} />
        </UiPrefsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
