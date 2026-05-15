-- ============================================================
-- dashboard_summary
--
-- One RPC, one round-trip. Folds the five existing per-widget
-- dashboard queries into a single JSON payload so /dashboard
-- hits Supabase ONCE per period change instead of five times.
--
-- Before: KpiRow, IncomeExpenseChart (totals), PoliciesDonut,
--   DebtBuckets, and TopCompanies each fired their own RPC on
--   mount and on every period/branch toggle. With CORS preflights,
--   that's ~10 HTTP requests for the dashboard core alone.
--
-- After: one HTTP call returns everything as JSON; widgets read
--   their slice off a shared React Query cache. Period toggle
--   triggers ONE network request that updates all five widgets.
--
-- We deliberately reuse the existing per-widget RPCs internally
-- instead of inlining the queries — same branch scoping,
-- super-admin bypass, and agent isolation stay identical, so
-- the new path can't drift from the old one.
--
-- IncomeExpenseChart's six-month trend (dashboard_income_expense_
-- monthly) is intentionally NOT folded in here — its parameters
-- (months horizon) are independent of the dashboard period, so
-- folding would force a refetch every period toggle even though
-- the trend itself didn't change. Stays in its own useQuery.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_summary(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL,
  p_top_companies_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kpis jsonb;
  v_overview jsonb;
  v_totals jsonb;
  v_buckets jsonb;
  v_companies jsonb;
BEGIN
  SELECT to_jsonb(t) INTO v_kpis
  FROM public.dashboard_kpis_v2(p_start_date, p_end_date, p_branch_id) t;

  SELECT to_jsonb(t) INTO v_overview
  FROM public.dashboard_policies_overview_range(p_start_date, p_end_date, p_branch_id) t;

  SELECT to_jsonb(t) INTO v_totals
  FROM public.dashboard_income_expense_totals(p_start_date, p_end_date, p_branch_id) t;

  -- Multi-row results aggregate to JSON arrays. Order is preserved
  -- from the inner functions (which already ORDER BY internally
  -- where it matters — top_companies orders by total_profit DESC).
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_buckets
  FROM public.dashboard_client_debt_buckets_range(p_start_date, p_end_date, p_branch_id) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_companies
  FROM public.dashboard_top_companies(p_start_date, p_end_date, p_top_companies_limit, p_branch_id) t;

  -- Empty-result fallbacks mirror what the per-widget hooks
  -- already do client-side when their RPC returns no rows.
  RETURN jsonb_build_object(
    'kpis', COALESCE(v_kpis, jsonb_build_object(
      'total_clients', 0,
      'cars_insured', 0,
      'policies_count', 0,
      'period_profit', 0
    )),
    'policies_overview', COALESCE(v_overview, jsonb_build_object(
      'active_count', 0,
      'expiring_30d_count', 0,
      'expired_count', 0,
      'cancelled_count', 0
    )),
    'income_expense_totals', COALESCE(v_totals, jsonb_build_object(
      'income', 0,
      'expense', 0
    )),
    'debt_buckets', v_buckets,
    'top_companies', v_companies
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date, date, uuid, integer) TO authenticated;
