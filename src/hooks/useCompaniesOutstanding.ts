import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Outstanding balance the agent owes each insurance company — the
// "المستحق للشركة" pill the receipts wizard shows next to every
// company name. Computed directly from policies.payed_for_company so
// the value reacts immediately when the agent edits a policy's
// company-net (CompanySettlement uses the same source of truth, so
// the two screens stay in lockstep without the ab_ledger middleware
// that goes stale on policy edits).
//
// Formula:
//   outstanding =
//       SUM(payed_for_company)   ← live debt from non-cancelled policies
//     − SUM(outgoing settlements) ← cash we paid the company
//     − SUM(incoming settlements) ← cash the company paid us (refunds, commission)
//     + SUM(company credit notes) ← إشعار دائن paper, ADDS to debt because
//                                    crediting the company's account in our
//                                    books means our liability to them grew
//                                    (opposite sign convention from customer
//                                    + broker credit notes — see PHASE 1
//                                    migration header for why)
//
// Refused settlements are excluded — the matching trigger restores
// the ledger entry and the receipts mirror surfaces a cancellation
// row, so a refused سند صرف has no net effect on what's owed.

export interface CompanyOutstanding {
  /** Σ payed_for_company across active (non-cancelled, non-transferred) policies. */
  totalPayable: number;
  /** Σ outgoing settlements (cash the agent paid the company), non-refused. */
  totalPaidOut: number;
  /** Σ incoming settlements (cash the company paid the agent), non-refused. */
  totalPaidIn: number;
  /** Σ credit-note receipts for this company (ADD to debt). */
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
  const [outstandingByCompany, setOutstandingByCompany] = useState<
    Map<string, CompanyOutstanding>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [policiesRes, settlementsRes, creditNotesRes] = await Promise.all([
          supabase
            .from('policies')
            .select('company_id, payed_for_company, cancelled, transferred')
            .is('deleted_at', null),
          supabase
            .from('company_settlements')
            .select('company_id, total_amount, direction, refused'),
          supabase
            .from('receipts')
            .select('company_id, amount, cancelled_at')
            .eq('receipt_type', 'credit_note')
            .not('company_id', 'is', null),
        ]);

        if (cancelled) return;
        if (policiesRes.error) throw policiesRes.error;
        if (settlementsRes.error) throw settlementsRes.error;
        if (creditNotesRes.error) throw creditNotesRes.error;

        const map = new Map<string, CompanyOutstanding>();
        const get = (id: string) => {
          let row = map.get(id);
          if (!row) {
            row = emptyRow();
            map.set(id, row);
          }
          return row;
        };

        // Policy-side debt — drop cancelled / transferred rows (their
        // company_payable ledger entries get reversed by the existing
        // policy_cancelled / policy_transferred triggers).
        for (const p of policiesRes.data ?? []) {
          if (!p.company_id) continue;
          if (p.cancelled || p.transferred) continue;
          const row = get(p.company_id);
          row.totalPayable += Number(p.payed_for_company || 0);
          row.policiesCount += 1;
        }

        // Settlements split by direction so the picker can show both
        // sides of the running account separately.
        for (const s of settlementsRes.data ?? []) {
          if (!s.company_id || s.refused) continue;
          const row = get(s.company_id);
          const amt = Number(s.total_amount || 0);
          if (s.direction === 'incoming') row.totalPaidIn += amt;
          else row.totalPaidOut += amt;
        }

        // إشعار دائن ADDS to debt.
        for (const r of creditNotesRes.data ?? []) {
          if (!r.company_id || r.cancelled_at) continue;
          const row = get(r.company_id);
          row.totalCreditNotes += Number(r.amount || 0);
        }

        // Final signed balance.
        for (const row of map.values()) {
          row.outstanding =
            row.totalPayable
            + row.totalCreditNotes
            - row.totalPaidOut
            - row.totalPaidIn;
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
  }, [refreshKey]);

  return {
    outstandingByCompany,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
