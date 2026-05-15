import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from './useAgentContext';

// Outstanding balance the agent owes each insurance company — the
// "المستحق للشركة" pill the receipts wizard shows next to every
// company name. Reads from get_company_outstanding_summary RPC
// (SECURITY DEFINER) so branch-scoped users still see the full
// agency view that the receipts wizard needs to make a decision —
// same pattern report_company_settlement uses on /company-settlement.
//
// Formula (mirrored in the RPC body):
//   outstanding = Σ payed_for_company         ← من البوليصات
//               − Σ outgoing settlements       ← سندات الصرف للشركة
//               − Σ credit_notes for company   ← إشعارات دائنة (على الحساب)
//               − Σ debit_notes for company    ← إشعارات مدينة (الشركة عليها)
//
// Incoming settlements (rare — company refunding the agent) are
// returned for display but excluded from outstanding; per the
// accountant model the dialog shows ONLY the three terms above.
// Debit notes also fold into outstanding directly (no separate
// breakdown column) per the user's "بدي بس المستحق فقط لا غير".
//
// Cancelled / transferred policies and refused settlements are
// excluded by the RPC.

export interface CompanyOutstanding {
  /** Σ payed_for_company across active (non-cancelled, non-transferred) policies. */
  totalPayable: number;
  /** Σ outgoing settlements (cash the agent paid the company), non-refused. */
  totalPaidOut: number;
  /** Σ incoming settlements (cash the company paid the agent), non-refused. */
  totalPaidIn: number;
  /** Σ credit-note receipts for this company (reduce المستحق). */
  totalCreditNotes: number;
  /** Count of active policies tied to this company. */
  policiesCount: number;
  /** Signed outstanding. Positive = agent owes company. Negative = company owes agent. */
  outstanding: number;
}

interface UseCompaniesOutstandingResult {
  /** Keyed by company_id. Missing keys mean no data found (treat as 0). */
  outstandingByCompany: Map<string, CompanyOutstanding>;
  loading: boolean;
  error: Error | null;
  /** Forces a re-fetch. Call after saving a voucher to keep the picker fresh. */
  refresh: () => void;
}

const emptyRow = (): CompanyOutstanding => ({
  totalPayable: 0,
  totalPaidOut: 0,
  totalPaidIn: 0,
  totalCreditNotes: 0,
  policiesCount: 0,
  outstanding: 0,
});

export function useCompaniesOutstanding(): UseCompaniesOutstandingResult {
  const { agentId } = useAgentContext();
  const [outstandingByCompany, setOutstandingByCompany] = useState<
    Map<string, CompanyOutstanding>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!agentId) {
      setOutstandingByCompany(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: rpcErr } = await supabase.rpc(
          'get_company_outstanding_summary',
          { p_agent_id: agentId } as never,
        );
        if (cancelled) return;
        if (rpcErr) throw rpcErr;

        const map = new Map<string, CompanyOutstanding>();
        for (const row of (data ?? []) as Array<{
          company_id: string;
          total_payable: number | string;
          total_paid_out: number | string;
          total_paid_in: number | string;
          total_credit_notes: number | string;
          policies_count: number | string;
          outstanding: number | string;
        }>) {
          map.set(row.company_id, {
            totalPayable: Number(row.total_payable),
            totalPaidOut: Number(row.total_paid_out),
            totalPaidIn: Number(row.total_paid_in),
            totalCreditNotes: Number(row.total_credit_notes),
            policiesCount: Number(row.policies_count),
            outstanding: Number(row.outstanding),
          });
        }
        setOutstandingByCompany(map);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId, refreshKey]);

  return {
    outstandingByCompany,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
