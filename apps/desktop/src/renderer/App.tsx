import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useTheme } from "./hooks/use-theme";
import { useChatTitledListener, useModelsRefreshListener } from "./hooks/use-ipc-data";
import { AuthProvider } from "./components/auth-provider";
import { WorkspaceProvider } from "./components/workspace-provider";
import { UiPrefsProvider } from "./components/ui-prefs";
import { AppShell } from "./components/app-shell";
import { ChatPage } from "./components/chat-page";
import { ProjectSettingsRedirect, SettingsPage } from "./components/settings-page";
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

/** Keyed by branchId so switching branches remounts the page instead of
 * carrying over draft text / streaming state from the previous branch. */
function ChatPageRoute() {
  const { branchId } = useParams();
  return <ChatPage key={branchId} />;
}

export default function App() {
  const { theme, setTheme } = useTheme();
  useModelsRefreshListener();
  useChatTitledListener();

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
              <Route path="/chats/:chatId/branches/:branchId" element={<ChatPageRoute />} />
              <Route path="/branches/compare" element={<Placeholder title="Compare branches" />} />
              <Route path="/costs" element={<Placeholder title="Costs" />} />
              {/* Project-level artifact/memory management, reached from settings. */}
              <Route path="/artifacts" element={<Placeholder title="Project artifacts" />} />
              <Route path="/memories" element={<Placeholder title="Project memories" />} />
              {/* Settings scopes: General ▸ Organizations ▸ Projects (the
                  override cascade). Bare /settings lands on General. */}
              <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
              <Route path="/settings/general" element={<SettingsPage />} />
              <Route path="/settings/providers" element={<SettingsPage />} />
              <Route path="/settings/providers/:provider" element={<SettingsPage />} />
              <Route path="/settings/mcp" element={<SettingsPage />} />
              <Route path="/settings/organization/:orgId" element={<SettingsPage />} />
              <Route path="/settings/project/:projectId" element={<SettingsPage />} />
              <Route path="/settings/project" element={<ProjectSettingsRedirect />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster theme={applied} />
        </UiPrefsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
