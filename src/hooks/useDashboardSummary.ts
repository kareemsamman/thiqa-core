import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PeriodRange } from '@/components/dashboard/PeriodPills';

// One-shot dashboard payload — every widget reads its own slice
// off the same React Query cache instead of firing its own RPC.
// Backed by the dashboard_summary Postgres function which folds
// 5 per-widget RPCs into one round-trip.
export interface DashboardSummary {
  kpis: {
    total_clients: number;
    cars_insured: number;
    policies_count: number;
    period_profit: number;
  };
  policies_overview: {
    active_count: number;
    expiring_30d_count: number;
    expired_count: number;
    cancelled_count: number;
  };
  income_expense_totals: {
    income: number;
    expense: number;
  };
  debt_buckets: Array<{
    bucket: 'overdue_60' | 'overdue_30' | 'current' | 'paid';
    tx_count: number;
    amount: number;
  }>;
  top_companies: Array<{
    company_id: string;
    company_name: string;
    tx_count: number;
    total_profit: number;
  }>;
}

const EMPTY_SUMMARY: DashboardSummary = {
  kpis: { total_clients: 0, cars_insured: 0, policies_count: 0, period_profit: 0 },
  policies_overview: {
    active_count: 0,
    expiring_30d_count: 0,
    expired_count: 0,
    cancelled_count: 0,
  },
  income_expense_totals: { income: 0, expense: 0 },
  debt_buckets: [],
  top_companies: [],
};

/**
 * Shared dashboard data for KpiRow, IncomeExpenseChart (totals),
 * PoliciesDonut, DebtBuckets, and TopCompanies.
 *
 * All five widgets call this hook with the same (range, branchId)
 * and React Query collapses them to a single in-flight request
 * via the shared queryKey. Period toggle invalidates the key →
 * single refetch updates every widget.
 */
export function useDashboardSummary(range: PeriodRange, branchId?: string | null) {
  const query = useQuery({
    queryKey: ['dashboard-summary', range.start, range.end, branchId ?? null],
    // 30s feels long enough to absorb a same-period revisit but
    // short enough that a fresh policy entry is reflected when the
    // user lands back on the dashboard. The page also dispatches
    // 'thiqa:policy-created' for the widgets that want to react
    // immediately — see useDashboardSummaryInvalidator below.
    staleTime: 30 * 1000,
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await (supabase.rpc as any)('dashboard_summary', {
        p_start_date: range.start,
        p_end_date: range.end,
        p_branch_id: branchId ?? null,
        p_top_companies_limit: 5,
      });
      if (error) throw error;
      // RPC returns jsonb — Supabase JS gives it back as a parsed object.
      const row = (data ?? null) as DashboardSummary | null;
      return row ?? EMPTY_SUMMARY;
    },
  });

  return {
    data: query.data ?? EMPTY_SUMMARY,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Six-month income/expense trend for the IncomeExpenseChart area
 * graph. Independent of the dashboard period (always 6 months),
 * so it caches separately and survives period toggles.
 */
export function useDashboardMonthly(branchId?: string | null) {
  const query = useQuery({
    queryKey: ['dashboard-monthly', branchId ?? null],
    // Trend changes only when a new policy/payment lands in a new
    // month — once a minute is fine.
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('dashboard_income_expense_monthly', {
        p_months: 6,
        p_branch_id: branchId ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as Array<{ month: string; income: number; expense: number }>).map((r) => ({
        month: r.month,
        income: Number(r.income ?? 0),
        expense: Number(r.expense ?? 0),
      }));
    },
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
