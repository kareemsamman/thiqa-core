import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useAccidentReportsCount() {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { count: activeCount, error } = await supabase
          .from('accident_reports')
          .select('*', { count: 'exact', head: true })
          .neq('status', 'closed');

        if (error) throw error;
        setCount(activeCount || 0);
      } catch (error) {
        console.error('Error fetching accident reports count:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCount();

    // Set up realtime subscription
    const channel = supabase
      .channel('accident-reports-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accident_reports' },
        () => fetchCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { count, isLoading };
}
