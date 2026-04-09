import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useRenewalsCount() {
  const [renewalsCount, setRenewalsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    try {
      // Get current month for default filter
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
      
      const { data, error } = await supabase.rpc('report_renewals_summary', {
        p_end_month: `${currentMonth}-01`,
        p_policy_type: null,
        p_created_by: null,
        p_search: null
      });
      
      if (error) {
        console.error('Error fetching renewals count:', error);
        setIsLoading(false);
        return;
      }
      
      if (data && data.length > 0) {
        setRenewalsCount(data[0].total_expiring || 0);
      }
    } catch (err) {
      console.error('Unexpected error fetching renewals count:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 60000); // Refresh every minute
    window.addEventListener('focus', fetchCount);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', fetchCount);
    };
  }, [fetchCount]);

  return { renewalsCount, isLoading };
}
