import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ClaimsCountResult {
  claimsCount: number;
  isLoading: boolean;
}

export function useClaimsCount(): ClaimsCountResult {
  const [claimsCount, setClaimsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchClaimsCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('repair_claims')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'completed');
      
      if (error) {
        console.error('Error fetching claims count:', error);
        return;
      }
      
      setClaimsCount(count || 0);
    } catch (error) {
      console.error('Error fetching claims count:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaimsCount();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchClaimsCount, 30000);
    
    // Refresh on window focus
    const handleFocus = () => fetchClaimsCount();
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchClaimsCount]);

  return { claimsCount, isLoading };
}
