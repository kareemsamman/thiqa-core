import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { usePermissions, PermissionKey } from '@/hooks/usePermissions';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

interface PermissionRouteProps {
  permission: PermissionKey;
  children: ReactNode;
}

/**
 * Route guard keyed by a single permission string. Admin / super admin
 * / impersonating super admin all bypass the check (they can see
 * everything in their agent). Workers fall through to the
 * profile.permissions → agent.default_employee_permissions → false
 * resolution inside usePermissions.
 *
 * Replaces AdminRoute. Use:
 *   <PermissionRoute permission="page.brokers">
 *     <Brokers />
 *   </PermissionRoute>
 */
export function PermissionRoute({ permission, children }: PermissionRouteProps) {
  const { user, loading, profileLoading, profile, isActive, isSuperAdmin } = useAuth();
  const { isImpersonating } = useAgentContext();
  const { can, loading: permsLoading } = usePermissions();

  const needsProfileLoading = user && !isSuperAdmin && profileLoading && !profile;

  if (loading || needsProfileLoading || permsLoading) {
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

  return <>{children}</>;
}
