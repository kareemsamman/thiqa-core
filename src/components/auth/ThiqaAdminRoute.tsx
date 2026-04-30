import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export function ThiqaAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profileLoading, isSuperAdmin } = useAuth();

  // Two-phase auth load: `loading` covers the session restore;
  // `profileLoading` covers the thiqa_super_admins lookup that
  // populates isSuperAdmin. Without waiting for the second phase the
  // route saw isSuperAdmin=false on first render and bounced the
  // user to "/" before the lookup finished. Other Thiqa pages
  // tolerate this only because StrictMode / cache often races us
  // through the gap.
  if (loading || (user && profileLoading)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
