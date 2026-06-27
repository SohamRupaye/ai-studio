import { createContext, useContext, useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
}

export type AuthStatus = "loading" | "unauthenticated" | "needs-onboarding" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  providers: Record<string, string[]>;
  /** Re-check auth state (call after onboarding / key setup) */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<Record<string, string[]>>({});

  const check = useCallback(async () => {
    try {
      setStatus("loading");

      // Fetch user and available models in parallel
      const [userData, models] = await Promise.all([
        window.ipc.invoke("user:get", undefined),
        window.ipc.invoke("models:list", undefined),
      ]);

      setProviders(models);

      if (!userData) {
        // No user set up yet — needs onboarding
        setUser(null);
        setStatus("needs-onboarding");
        return;
      }

      setUser(userData);

      // Check if at least one provider has models available
      const hasProvider = Object.keys(models).length > 0;
      if (!hasProvider) {
        // User exists but no providers configured
        setStatus("unauthenticated");
        return;
      }

      setStatus("authenticated");
    } catch (err) {
      console.error("[auth] Failed to check auth state:", err);
      // If IPC fails entirely (shouldn't happen in Electron), treat as needs-onboarding
      setStatus("needs-onboarding");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <AuthContext.Provider value={{ status, user, providers, refresh: check }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
