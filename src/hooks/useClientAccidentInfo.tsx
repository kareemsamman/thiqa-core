import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AccidentReport {
  id: string;
  accident_date: string;
  status: string;
  report_number: number;
  car: { id: string; car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
}

export function useClientAccidentInfo(clientId: string | null) {
  const [reports, setReports] = useState<AccidentReport[]>([]);
  const [count, setCount] = useState(0);
  const [hasActiveReports, setHasActiveReports] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!clientId) {
      setReports([]);
      setCount(0);
      setHasActiveReports(false);
      setIsLoading(false);
      return;
    }

    const fetchAccidentInfo = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('accident_reports')
          .select(`
            id,
            accident_date,
            status,
            report_number,
            car:cars(id, car_number),
            company:insurance_companies(name, name_ar)
          `)
          .eq('client_id', clientId)
          .order('accident_date', { ascending: false });

        if (error) throw error;

        setReports(data || []);
        setCount(data?.length || 0);
        setHasActiveReports(data?.some(r => r.status !== 'closed') || false);
      } catch (error) {
        console.error('Error fetching client accident info:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAccidentInfo();

    // Subscribe to changes
    const channel = supabase
      .channel(`client-accidents-${clientId}`)
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'accident_reports',
          filter: `client_id=eq.${clientId}`
        },
        () => fetchAccidentInfo()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  return { reports, count, hasActiveReports, isLoading };
}
