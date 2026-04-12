import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Branch {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  is_active: boolean;
  is_default: boolean;
}

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, name_ar, slug, is_active, is_default')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setLoading(false);
    }
  }, []);

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
