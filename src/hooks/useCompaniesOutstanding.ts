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

        // Start with policy-side debt, dropping cancelled / transferred
        // rows (their company_payable ledger entries get reversed by
        // the existing policy_cancelled / policy_transferred triggers,
        // so the live debt should follow the same exclusion).
        const map = new Map<string, number>();
        for (const p of policiesRes.data ?? []) {
          if (!p.company_id) continue;
          if (p.cancelled || p.transferred) continue;
          const cur = map.get(p.company_id) ?? 0;
          map.set(p.company_id, cur + Number(p.payed_for_company || 0));
        }

        // Both outgoing (we paid them) and incoming (they paid us)
        // reduce the outstanding. Refused rows excluded — their
        // reversal trigger already restored the ledger entry.
        for (const s of settlementsRes.data ?? []) {
          if (!s.company_id || s.refused) continue;
          const cur = map.get(s.company_id) ?? 0;
          map.set(s.company_id, cur - Number(s.total_amount || 0));
        }

        // إشعار دائن ADDS to debt — the agent acknowledges they owe
        // the company more, outside the normal policy-issuance flow.
        for (const r of creditNotesRes.data ?? []) {
          if (!r.company_id || r.cancelled_at) continue;
          const cur = map.get(r.company_id) ?? 0;
          map.set(r.company_id, cur + Number(r.amount || 0));
        }

        const result = new Map<string, CompanyOutstanding>();
        for (const [id, val] of map.entries()) {
          result.set(id, { outstanding: val });
        }
        setOutstandingByCompany(result);
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
