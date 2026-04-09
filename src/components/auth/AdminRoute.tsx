import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Loader2 } from 'lucide-react';

interface AdminRouteProps {
  children: ReactNode;
}

/**
 * Route guard that only allows admin users to access the route.
 * Workers will be redirected to the dashboard.
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isAdmin, isSuperAdmin } = useAuth();
  const { isImpersonating } = useAgentContext();

  // Block during initial auth resolution
  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;
  
  if (loading || needsProfileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  // No user = go to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Thiqa super admin should only use Thiqa management routes (unless impersonating)
  if (isSuperAdmin && !isImpersonating) {
    return <Navigate to="/thiqa/agents" replace />;
  }

  // Not active = no access page
  if (!isActive) {
    return <Navigate to="/no-access" replace />;
  }

  // Not admin = redirect to dashboard (workers can't access admin routes)
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
