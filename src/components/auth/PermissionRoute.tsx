import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { usePermissions, PermissionKey } from '@/hooks/usePermissions';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

interface PermissionRouteProps {
  permission: PermissionKey;
  /**
   * Optional plan-level feature key. When set, the route also requires
   * hasFeature(featureKey) to be true — so the plan's default_features
   * can lock out a page even if the per-user permission would have
   * allowed it. Admin / super admin / impersonating super admin
   * bypass this check too (via hasFeature in useAgentContext).
   */
  feature?: string;
  children: ReactNode;
}

/**
 * Route guard keyed by a single permission string plus an optional
 * plan feature. Admin / super admin / impersonating super admin all
 * bypass both checks. Workers fall through to the
 * profile.permissions → agent.default_employee_permissions → false
 * resolution inside usePermissions.
 *
 * Replaces AdminRoute. Use:
 *   <PermissionRoute permission="page.brokers" feature="broker_wallet">
 *     <Brokers />
 *   </PermissionRoute>
 */
export function PermissionRoute({ permission, feature, children }: PermissionRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isSuperAdmin } = useAuth();
  const { isImpersonating, hasFeature, loading: agentLoading } = useAgentContext();
  const { can, loading: permsLoading } = usePermissions();

  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;

  if (loading || needsProfileLoading || permsLoading || agentLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Thiqa super admin should only use Thiqa management routes unless
  // they've opened an impersonation session on a specific agent.
  if (isSuperAdmin && !isImpersonating) {
    return <Navigate to="/thiqa/agents" replace />;
  }

  if (!isActive) {
    return <Navigate to="/no-access" replace />;
  }

  if (!can(permission)) {
    return <Navigate to="/" replace />;
  }

  if (feature && !hasFeature(feature)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
