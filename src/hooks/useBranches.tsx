import { useCallback, useEffect, useState } from 'react';
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

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  // Pull the active agent context so we can scope client-side. The
  // branches RLS lets a Thiqa super-admin see *every* row across every
  // agent (the policy is `is_super_admin OR agent_id = my_agent`), so
  // when a super-admin is impersonating an agent the RLS doesn't
  // narrow the result — we have to. Without this, the in-system
  // branch dropdown shows every branch from every agent on the
  // platform, including duplicates of names like "بيت حنينا".
  const { agentId } = useAgentContext();

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
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
      setBranches((data || []) as Branch[]);
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return '-';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || '-';
  };

  return { branches, loading, getBranchName, refetch: fetchBranches };
}
