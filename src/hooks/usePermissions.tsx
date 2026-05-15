import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useAgentContext } from './useAgentContext';
import { navigationGroups } from '@/components/layout/navigation';

/**
 * Permission groups for the per-user editor (UserPermissionsDialog +
 * DefaultEmployeePermissionsCard). Derived at module-load time from
 * the same `navigationGroups` array the sidebar renders, so:
 *   - any nav item with a permissionKey shows up in the editor
 *   - hidden / removed nav items disappear from the editor
 *     (no more dead checkboxes for routes that no longer exist)
 *   - new nav items pick up an editor row automatically
 *
 * The Thiqa super-admin group and items without a permissionKey are
 * skipped — they're not user-grantable. Empty groups are dropped.
 *
 * The "خاص" (special) group is appended manually for the cross-cut
 * permissions that don't correspond to a single page (view_financial
 * hides profit/commission/debt numbers across every page).
 *
 * Shape kept intentionally identical to the previous static export so
 * PermissionMatrix.tsx and the dialogs don't need to change.
 */
type PermissionGroup = {
  label: string;
  keys: ReadonlyArray<readonly [string, string]>;
};

function buildPermissionGroups(): PermissionGroup[] {
  const groups: PermissionGroup[] = [];
  for (const navGroup of navigationGroups) {
    if (navGroup.items.some((i) => i.thiqaSuperAdminOnly)) continue;
    const keys: Array<readonly [string, string]> = [];
    for (const item of navGroup.items) {
      if (!item.permissionKey) continue;
      if (item.thiqaSuperAdminOnly || item.superAdminOnly) continue;
      keys.push([item.permissionKey, item.name] as const);
    }
    if (keys.length > 0) {
      groups.push({ label: navGroup.name, keys });
    }
  }
  // Special, non-page permissions appended at the end.
  groups.push({
    label: 'خاص',
    keys: [
      ['view_financial', 'عرض الأرقام المالية (أرباح / عمولات / ديون)'] as const,
      ['access.all_branches', 'الوصول لكل الفروع'] as const,
    ],
  });
  return groups;
}

export const PERMISSION_GROUPS: PermissionGroup[] = buildPermissionGroups();

// Permissions are looked up by string everywhere, and unknown keys
// safely return false in `can()`. No need for a static union type.
export type PermissionKey = string;

/**
 * Hook returning the current user's permission resolver.
 *
 * Resolution order:
 *   1. Admin role (from useAuth.isAdmin) → always true (agent admin +
 *      Thiqa super admin + impersonating super admin all fall here).
 *   2. Explicit override on profiles.permissions[key].
 *   3. Agent template agents.default_employee_permissions[key].
 *   4. Missing → false.
 *
 * Backed by React Query so every component that calls usePermissions()
 * shares one fetch — no matter how many places in the tree mount it.
 * Before this, each call site had its own useState + useEffect, which
 * is why the Network tab showed `profiles?select=permissions` firing
 * 3 times on a single page load.
 */
export function usePermissions() {
  const { user, isAdmin } = useAuth();
  const { agent, loading: agentLoading } = useAgentContext();

  const { data: userPermissions = {}, isLoading: loading } = useQuery({
    queryKey: ['user-permissions', user?.id],
    enabled: !!user,
    // Permissions change rarely (admin edits via the user dialog);
    // 5 min lets a tab return cleanly without forcing a refetch.
    // Edits invalidate via queryClient elsewhere when we wire that up.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, boolean>> => {
      if (!user) return {};
      const { data, error } = await supabase
        .from('profiles')
        .select('permissions')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.error('Error loading permissions:', error);
        return {};
      }
      const raw = data?.permissions as unknown;
      const map =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, boolean> | null) ?? {};
      return map ?? {};
    },
  });

  const defaults = (agent?.default_employee_permissions ?? {}) as Record<string, boolean>;

  const can = (key: PermissionKey): boolean => {
    // Agent admin + super admin bypass the matrix entirely. This is
    // the product decision — the admin always sees everything in
    // their agent so they can configure it.
    if (isAdmin) return true;
    if (key in userPermissions) return userPermissions[key];
    if (key in defaults) return defaults[key];
    return false;
  };

  return {
    can,
    loading: loading || agentLoading,
    userPermissions,
    defaults,
  };
}
