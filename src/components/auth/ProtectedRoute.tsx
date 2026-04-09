import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isSuperAdmin } = useAuth();
  const { isImpersonating, isSubscriptionActive, isSubscriptionPaused, loading: agentLoading } = useAgentContext();

  const location = useLocation();
  // Super admin bypasses profile loading requirement
  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;
  
  if (loading || needsProfileLoading || (user && !isSuperAdmin && agentLoading)) {
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

  // Thiqa super admin should stay in Thiqa management routes only (unless impersonating)
  if (isSuperAdmin && !isImpersonating && !location.pathname.startsWith('/thiqa')) {
    return <Navigate to="/thiqa" replace />;
  }

  // Super admin and admins always have access (isActive includes this check)
  // Only show No Access for non-admin users with inactive status
  if (!isActive) {
    return <Navigate to="/no-access" replace />;
  }

  // Subscription expired or paused → redirect (super admins bypass)
  if (!isSuperAdmin && !isSubscriptionActive) {
    return <Navigate to="/subscription-expired" replace />;
  }

  return <>{children}</>;
}
