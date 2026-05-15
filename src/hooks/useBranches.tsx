import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';

export interface Branch {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  is_active: boolean;
  is_default: boolean;
  status: 'active' | 'plan_locked';
}

/**
 * Hook returning the agent's active branches.
 *
 * Backed by React Query so every call site (sidebar branch picker,
 * client list filter, dashboard widgets, etc.) shares ONE fetch
 * keyed by agentId — instead of each component firing its own
 * `branches` request on mount, which is what made the Network tab
 * show the same query repeated on every page load.
 */
export function useBranches() {
  const queryClient = useQueryClient();
  // Pull the active agent context so we can scope client-side. The
  // branches RLS lets a Thiqa super-admin see *every* row across every
  // agent (the policy is `is_super_admin OR agent_id = my_agent`), so
  // when a super-admin is impersonating an agent the RLS doesn't
  // narrow the result — we have to. Without this, the in-system
  // branch dropdown shows every branch from every agent on the
  // platform, including duplicates of names like "بيت حنينا".
  const { agentId } = useAgentContext();

  const { data: branches = [], isLoading: loading } = useQuery({
    queryKey: ['branches', agentId],
    // Branches change rarely (admin adds/edits via /admin/branches);
    // 10 min keeps the dropdown snappy without going stale in practice.
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Branch[]> => {
      let query = supabase
        .from('branches')
        .select('id, name, name_ar, slug, is_active, is_default, status')
        .eq('is_active', true)
        .order('name');
      if (agentId) {
        query = query.eq('agent_id', agentId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Branch[];
    },
  });

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return '-';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || '-';
  };

  // Manual refresh hook for callers that just inserted/updated a
  // branch and want the dropdown to reflect it without a page reload
  // (BranchManagement page uses this).
  const refetch = () => queryClient.invalidateQueries({ queryKey: ['branches', agentId] });

  return { branches, loading, getBranchName, refetch };
}
