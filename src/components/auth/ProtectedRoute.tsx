import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isSuperAdmin } = useAuth();
  const { isImpersonating, isSubscriptionActive, isSubscriptionPaused, loading: agentLoading } = useAgentContext();

  const location = useLocation();

  // Detect Google/OAuth users who haven't been set up yet — they get
  // forwarded to /oauth-confirm where they explicitly approve account
  // creation (and see what data Google sent us). The auto-setup that
  // used to run here is now handled there instead.
  const isOAuthUser = !!user && (
    user.app_metadata?.providers?.includes('google') ||
    user.app_metadata?.provider === 'google' ||
    (user.user_metadata as any)?.iss === 'https://accounts.google.com'
  );
  const needsOAuthSetup = isOAuthUser && !isSuperAdmin && !profile?.agent_id && !loading && !profileLoading;

  // Super admin bypasses profile loading requirement
  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;

  // Show loading while: auth loading, profile loading, or agent context loading
  if (loading || needsProfileLoading || (user && !isSuperAdmin && agentLoading)) {
    return <LoadingScreen message="جاري التحميل..." />;
  }

  // No user = go to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // OAuth user that hasn't been set up yet → /oauth-confirm. Skip the
  // forwarding when we're already there (the page handles itself).
  if (needsOAuthSetup && location.pathname !== '/oauth-confirm') {
    return <Navigate to="/oauth-confirm" replace />;
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

  // Subscription expired or paused → redirect.
  // Super admins normally bypass, BUT when they're impersonating an
  // agent they should see exactly what the agent sees — including the
  // lockout. Without this, you can't QA the expired-trial UX without
  // logging in as the agent separately. The exit-impersonation banner
  // is rendered inside SubscriptionExpired so the super admin can
  // always get back to /thiqa.
  if ((!isSuperAdmin || isImpersonating) && !isSubscriptionActive) {
    return <Navigate to="/subscription-expired" replace />;
  }

  return <>{children}</>;
}
