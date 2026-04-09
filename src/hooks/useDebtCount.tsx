import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DebtCountResult {
  debtCount: number;
  isLoading: boolean;
}

export function useDebtCount(): DebtCountResult {
  const [debtCount, setDebtCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDebtCount = useCallback(async () => {
    try {
      // Call with explicit parameters to avoid function overload ambiguity
      const { data, error } = await supabase.rpc('report_client_debts_summary', {
        p_search: null,
        p_filter_days: null
      });
      
      if (error) {
        console.error('Error fetching debt count:', error);
        return;
      }
      
      // The RPC returns an array with one row containing total_clients
      if (data && Array.isArray(data) && data.length > 0) {
        setDebtCount(Number(data[0].total_clients) || 0);
      } else if (data && typeof data === 'object' && 'total_clients' in data) {
        setDebtCount(Number(data.total_clients) || 0);
      }
    } catch (error) {
      console.error('Error fetching debt count:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDebtCount();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchDebtCount, 30000);
    
    // Refresh on window focus
    const handleFocus = () => fetchDebtCount();
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchDebtCount]);

  return { debtCount, isLoading };
}
