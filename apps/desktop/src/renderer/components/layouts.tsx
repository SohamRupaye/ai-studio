import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { RightPanel } from "./right-panel";
import { TitleBar } from "./title-bar";
import { AuthGuard, GuestGuard } from "./auth-guard";
import { useUiPrefs } from "./ui-prefs";

// ── Shared page loader ─────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

// ── App layout ───────────────────────────────────────────────────────────────
// Title bar + sidebar form one continuous, subtly tinted window frame.
// Page content floats on an elevated, rounded canvas inset into the frame;
// each route change rises in. The right panel lives inside the canvas.

export function AppLayout() {
  const { rightPanelOpen } = useUiPrefs();
  const location = useLocation();
  // The right panel is chat context (live tokens, memories, artifacts) —
  // it only exists inside a chat. Every other page gets the full canvas.
  const inChat = /^\/chat\/(?!new$)/.test(location.pathname);
  return (
    <div className="frame-atmosphere flex h-screen w-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 overflow-hidden px-2.5 pb-2.5 pt-1.5">
          <div className="flex flex-1 overflow-hidden rounded-xl border border-border/70 bg-canvas shadow-canvas">
            <main className="flex flex-1 overflow-hidden">
              <AuthGuard>
                <Suspense fallback={<PageLoader />}>
                  <div key={location.pathname} className="animate-rise flex flex-1 overflow-hidden">
                    <Outlet />
                  </div>
                </Suspense>
              </AuthGuard>
            </main>
            {inChat && rightPanelOpen && <RightPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Auth layout: minimal shell + guest guard (login/onboarding) ─────────────

export function AuthLayout() {
  return (
    <div className="frame-atmosphere flex h-screen w-screen flex-col overflow-hidden">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center overflow-hidden">
        <GuestGuard>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </GuestGuard>
      </main>
    </div>
  );
}
