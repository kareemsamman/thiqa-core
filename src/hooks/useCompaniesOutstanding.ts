import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
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

const EMPTY_MAP: Map<string, CompanyOutstanding> = new Map();

/**
 * Outstanding-per-company data, deduped via React Query.
 *
 * Used by Receipts page, CompaniesSection on /accounting, and the
 * AddCompanyDebitNoteDialog — every consumer of this hook reads
 * off the same in-memory cache keyed by agentId, so three mounted
 * call sites collapse to a single in-flight RPC instead of firing
 * `get_company_outstanding_summary` once each.
 */
export function useCompaniesOutstanding(): UseCompaniesOutstandingResult {
  const { agentId } = useAgentContext();
  const queryClient = useQueryClient();

  const query = useQuery<Map<string, CompanyOutstanding>>({
    queryKey: ['companies-outstanding', agentId ?? null],
    enabled: !!agentId,
    // Outstanding shifts whenever a voucher or settlement lands.
    // 60s is conservative — call refresh() explicitly after writes
    // (the dialogs that mutate this data already do).
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, CompanyOutstanding>> => {
      const { data, error } = await supabase.rpc(
        'get_company_outstanding_summary',
        { p_agent_id: agentId } as never,
      );
      if (error) throw error;
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
      return map;
    },
  });

  const refresh = useCallback(
    () => {
      queryClient.invalidateQueries({ queryKey: ['companies-outstanding', agentId ?? null] });
    },
    [queryClient, agentId],
  );

  return {
    outstandingByCompany: query.data ?? EMPTY_MAP,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refresh,
  };
}
