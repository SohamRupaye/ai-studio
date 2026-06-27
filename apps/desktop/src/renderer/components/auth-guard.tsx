import { Navigate } from "react-router-dom";
import { useAuth } from "./auth-provider";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Protects routes that require authentication.
 * Redirects to /onboarding if no user, /login if no providers configured.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (status === "needs-onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Protects auth pages from authenticated users.
 * If already authenticated, redirect to dashboard.
 */
export function GuestGuard({ children }: AuthGuardProps) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
