import { Routes, Route, Navigate } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { useTheme } from "./hooks/use-theme";
import { useModelsRefreshListener } from "./hooks/use-ipc-data";
import { AuthProvider } from "./components/auth-provider";
import { WorkspaceProvider } from "./components/workspace-provider";
import { UiPrefsProvider } from "./components/ui-prefs";
import { AppLayout, AuthLayout } from "./components/layouts";
import { appRoutes, authRoutes } from "./pages/routes";

export default function App() {
  useTheme();
  useModelsRefreshListener();

  return (
    <TooltipProvider delayDuration={400}>
      <Toaster />
      <AuthProvider>
        <WorkspaceProvider>
          <UiPrefsProvider>
            <Routes>
              {/* Auth routes — minimal shell, guest-only */}
              <Route element={<AuthLayout />}>
                {authRoutes.map(({ path, Component }) => (
                  <Route key={path} path={path} element={<Component />} />
                ))}
              </Route>

              {/* App routes — full shell, auth-protected */}
              <Route element={<AppLayout />}>
                {appRoutes.map(({ path, index, Component }) =>
                  index ? (
                    <Route key={path} index element={<Component />} />
                  ) : (
                    <Route key={path} path={path} element={<Component />} />
                  )
                )}
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </UiPrefsProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </TooltipProvider>
  );
}
