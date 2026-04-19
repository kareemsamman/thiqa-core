import { ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { supabase } from '@/integrations/supabase/client';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isSuperAdmin, refreshProfile } = useAuth();
  const { isImpersonating, isSubscriptionActive, isSubscriptionPaused, loading: agentLoading } = useAgentContext();
  const [oauthSetupState, setOauthSetupState] = useState<'idle' | 'running' | 'done'>('idle');
  const setupStartedRef = useRef(false);

  const location = useLocation();

  // Detect if this is a Google/OAuth user who needs agent setup
  const isOAuthUser = !!user && (
    user.app_metadata?.providers?.includes('google') ||
    user.app_metadata?.provider === 'google' ||
    (user.user_metadata as any)?.iss === 'https://accounts.google.com'
  );
  // Need setup if: OAuth user, not super admin, no agent, and done loading
  const needsOAuthSetup = isOAuthUser && !isSuperAdmin && !profile?.agent_id && !loading && !profileLoading;

  // Run setup-oauth-user when needed
  useEffect(() => {
    if (!needsOAuthSetup || oauthSetupState !== 'idle' || setupStartedRef.current) return;
    setupStartedRef.current = true;
    setOauthSetupState('running');

    supabase.functions.invoke("setup-oauth-user").then(async ({ data, error }) => {
      if (error) {
        console.error('[ProtectedRoute] setup-oauth-user error:', error);
      } else if (data?.success) {
        await refreshProfile();
      }
      setOauthSetupState('done');
    });
  }, [needsOAuthSetup, oauthSetupState, refreshProfile]);

  // Super admin bypasses profile loading requirement
  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;

  // Show loading while: auth loading, profile loading, agent context loading, OR oauth setup running/needed
  const isSettingUp = oauthSetupState === 'running' || (needsOAuthSetup && oauthSetupState === 'idle');
  if (loading || needsProfileLoading || isSettingUp || (user && !isSuperAdmin && agentLoading)) {
    return (
      <LoadingScreen message={isSettingUp ? "جاري إعداد حسابك..." : "جاري التحميل..."} />
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
