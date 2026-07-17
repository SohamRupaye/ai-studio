import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useTheme } from "./hooks/use-theme";
import { useChatTitledListener, useMCPChangedListener, useModelsRefreshListener, useNotifyActivatedListener, useSkillsChangedListener } from "./hooks/use-ipc-data";
import { AuthProvider } from "./components/auth-provider";
import { WorkspaceProvider } from "./components/workspace-provider";
import { UiPrefsProvider } from "./components/ui-prefs";
import { AppShell } from "./components/app-shell";
import { ChatPage } from "./components/chat-page";
import { ArtifactsPage } from "./components/artifacts-page";
import { MemoriesPage } from "./components/memories-page";
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
  useMCPChangedListener();
  useSkillsChangedListener();
  useNotifyActivatedListener();

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
              <Route path="/spaces/:spaceId/memories" element={<MemoriesPage />} />
              <Route path="/spaces/:spaceId/artifacts" element={<ArtifactsPage />} />
              <Route path="/chats/:chatId" element={<Placeholder title="Chat" />} />
              <Route path="/chats/:chatId/branches/:branchId" element={<ChatPageRoute />} />
              <Route path="/branches/compare" element={<Placeholder title="Compare branches" />} />
              <Route path="/costs" element={<Placeholder title="Costs" />} />
              {/* Project-level artifact/memory management, reached from settings. */}
              <Route path="/artifacts" element={<ArtifactsPage />} />
              <Route path="/memories" element={<MemoriesPage />} />
              {/* Settings scopes: General ▸ Organizations ▸ Projects (the
                  override cascade). Bare /settings lands on General. */}
              <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
              <Route path="/settings/general" element={<SettingsPage />} />
              <Route path="/settings/providers" element={<SettingsPage />} />
              <Route path="/settings/providers/:provider" element={<SettingsPage />} />
              <Route path="/settings/mcp" element={<SettingsPage />} />
              <Route path="/settings/skills" element={<SettingsPage />} />
              <Route path="/settings/automations" element={<SettingsPage />} />
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
