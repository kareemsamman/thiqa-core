-- ============================================================
-- Dashboard RPCs: branch awareness for branch-scoped users
--
-- Companion to 20260427120000 — that migration extended branch
-- isolation to admins via can_see_all_branches(). The dashboard
-- and related summary RPCs are SECURITY DEFINER (RLS off inside),
-- so they need to call can_see_all_branches() / get_my_branch_id()
-- explicitly to give a branch-scoped user (admin or worker) only
-- their branch's aggregates.
--
-- Tables affected by branch filter:
--   * clients   — has branch_id
--   * policies  — has branch_id
--   * cars      — has branch_id (verified in 20251220104245)
--
-- NOTE: An earlier draft of this migration mistakenly believed
-- expenses had no branch_id and therefore did NOT branch-filter the
-- expense subqueries in dashboard_kpis_v2 / income_expense_monthly /
-- income_expense_totals. expenses does have branch_id (since the
-- original CREATE TABLE in 20260109134153). Migration
-- 20260427120200 re-creates those three functions with the correct
-- expense branch filter — keep it in the chain.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_kpis_v2(p_start_date date, p_end_date date)
RETURNS TABLE(
  total_clients bigint,
  cars_insured bigint,
  policies_count bigint,
  period_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::numeric;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.clients c
      WHERE c.deleted_at IS NULL
        AND c.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR c.agent_id = v_agent_id)
        AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
    )::bigint AS total_clients,
    (SELECT COUNT(*) FROM public.cars ca
      WHERE ca.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR ca.agent_id = v_agent_id)
        AND (v_see_all OR ca.branch_id IS NULL OR ca.branch_id = v_my_branch)
    )::bigint AS cars_insured,
    (SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
       FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR p.agent_id = v_agent_id)
        AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
    )::bigint AS policies_count,
    (
      COALESCE((
        SELECT SUM(COALESCE(p.profit, 0))
          FROM public.policies p
         WHERE p.cancelled = false AND p.deleted_at IS NULL
           AND p.policy_type_parent::text <> 'ELZAMI'
           AND p.start_date BETWEEN p_start_date AND p_end_date
           AND (v_is_sa OR p.agent_id = v_agent_id)
           AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      ), 0)
      -
      -- expenses table has no branch_id; for a branch-scoped user the
      -- expense subtraction is the agent-wide total. Documented above.
      COALESCE((
        SELECT SUM(COALESCE(e.amount, 0))
          FROM public.expenses e
         WHERE e.voucher_type = 'payment'
           AND e.expense_date BETWEEN p_start_date AND p_end_date
           AND (v_is_sa OR e.agent_id = v_agent_id)
      ), 0)
    )::numeric AS period_profit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_kpis_v2(date, date) TO authenticated;


CREATE OR REPLACE FUNCTION public.dashboard_income_expense_monthly(p_months integer DEFAULT 6)
RETURNS TABLE(
  month date,
  income numeric,
  expense numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
  v_start date;
BEGIN
  v_start := date_trunc('month', CURRENT_DATE - ((p_months - 1) || ' months')::interval)::date;

  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(
      v_start,
      date_trunc('month', CURRENT_DATE)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  income_src AS (
    SELECT date_trunc('month', p.start_date)::date AS month_start,
           SUM(COALESCE(p.profit, 0)) AS income
      FROM public.policies p
     WHERE p.cancelled = false
       AND p.deleted_at IS NULL
       AND p.policy_type_parent::text <> 'ELZAMI'
       AND p.start_date >= v_start
       AND (v_is_sa OR p.agent_id = v_agent_id)
       AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
     GROUP BY date_trunc('month', p.start_date)
  ),
  expense_src AS (
    SELECT date_trunc('month', e.expense_date)::date AS month_start,
           SUM(COALESCE(e.amount, 0)) AS expense
      FROM public.expenses e
     WHERE e.voucher_type = 'payment'
       AND e.expense_date >= v_start
       AND (v_is_sa OR e.agent_id = v_agent_id)
     GROUP BY date_trunc('month', e.expense_date)
  )
  SELECT
    m.month_start::date,
    COALESCE(i.income, 0)::numeric,
    COALESCE(x.expense, 0)::numeric
  FROM months m
  LEFT JOIN income_src i ON i.month_start = m.month_start
  LEFT JOIN expense_src x ON x.month_start = m.month_start
  ORDER BY m.month_start;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_monthly(integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.dashboard_income_expense_totals(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(income numeric, expense numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN QUERY SELECT 0::numeric, 0::numeric;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(p.profit, 0))
        FROM public.policies p
       WHERE p.cancelled = false AND p.deleted_at IS NULL
         AND p.policy_type_parent::text <> 'ELZAMI'
         AND p.start_date BETWEEN p_start_date AND p_end_date
         AND (v_is_sa OR p.agent_id = v_agent_id)
         AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
    ), 0)::numeric AS income,
    COALESCE((
      SELECT SUM(COALESCE(e.amount, 0))
        FROM public.expenses e
       WHERE e.voucher_type = 'payment'
         AND e.expense_date BETWEEN p_start_date AND p_end_date
         AND (v_is_sa OR e.agent_id = v_agent_id)
    ), 0)::numeric AS expense;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_totals(date, date) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_top_companies(date, date, integer);

CREATE OR REPLACE FUNCTION public.dashboard_top_companies(
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  tx_count bigint,
  total_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    ic.id AS company_id,
    COALESCE(ic.name_ar, ic.name)::text AS company_name,
    COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))::bigint AS tx_count,
    COALESCE(SUM(COALESCE(p.profit, 0)), 0)::numeric AS total_profit
  FROM public.policies p
  JOIN public.insurance_companies ic ON ic.id = p.company_id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.policy_type_parent::text <> 'ELZAMI'
    AND p.created_at::date BETWEEN p_start_date AND p_end_date
    AND (v_is_sa OR (p.agent_id = v_agent_id AND ic.agent_id = v_agent_id))
    AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
  GROUP BY ic.id, ic.name_ar, ic.name
  HAVING COALESCE(SUM(COALESCE(p.profit, 0)), 0) <> 0
  ORDER BY total_profit DESC, tx_count DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_companies(date, date, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.dashboard_policies_overview_range(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  active_count bigint,
  expiring_30d_count bigint,
  expired_count bigint,
  cancelled_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + INTERVAL '30 days';
BEGIN
  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH tx AS (
    SELECT
      COALESCE(p.group_id::text, p.id::text) AS tx_id,
      BOOL_OR(p.cancelled) AS any_cancelled,
      MAX(p.end_date) AS end_date
    FROM public.policies p
    WHERE p.deleted_at IS NULL
      AND p.created_at::date BETWEEN p_start_date AND p_end_date
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
    GROUP BY COALESCE(p.group_id::text, p.id::text)
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date >= v_today AND end_date > v_horizon)::bigint,
    COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date >= v_today AND end_date <= v_horizon)::bigint,
    COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date < v_today)::bigint,
    COUNT(*) FILTER (WHERE any_cancelled)::bigint
  FROM tx;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_policies_overview_range(date, date) TO authenticated;


CREATE OR REPLACE FUNCTION public.dashboard_client_debt_buckets_range(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  bucket text,
  tx_count bigint,
  amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF NOT v_is_sa THEN
    v_agent_id := public.get_user_agent_id(auth.uid());
    IF v_agent_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH scoped_policies AS (
    SELECT
      p.id,
      COALESCE(p.group_id::text, p.id::text) AS tx_id,
      p.start_date,
      (p.insurance_price
        + CASE WHEN p.policy_type_parent::text = 'ELZAMI'
               THEN COALESCE(p.office_commission, 0)
               ELSE 0
          END) AS owed
    FROM public.policies p
    WHERE p.deleted_at IS NULL
      AND p.cancelled = false
      AND COALESCE(p.transferred, false) = false
      AND p.broker_id IS NULL
      AND p.start_date BETWEEN p_start_date AND p_end_date
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
  ),
  per_policy_paid AS (
    SELECT sp.id, COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS paid
    FROM scoped_policies sp
    LEFT JOIN public.policy_payments pp ON pp.policy_id = sp.id
    GROUP BY sp.id
  ),
  tx AS (
    SELECT
      sp.tx_id,
      SUM(sp.owed) AS tx_owed,
      SUM(pps.paid) AS tx_paid,
      MAX(sp.start_date) AS latest_start
    FROM scoped_policies sp
    JOIN per_policy_paid pps ON pps.id = sp.id
    GROUP BY sp.tx_id
  ),
  tx_bucketed AS (
    SELECT
      tx.tx_id,
      GREATEST(tx.tx_owed - tx.tx_paid, 0) AS remaining,
      CASE
        WHEN GREATEST(tx.tx_owed - tx.tx_paid, 0) <= 0 THEN 'paid'
        WHEN (CURRENT_DATE - tx.latest_start) > 60 THEN 'overdue_60'
        WHEN (CURRENT_DATE - tx.latest_start) > 30 THEN 'overdue_30'
        ELSE 'current'
      END AS bucket
    FROM tx
  )
  SELECT
    b.bucket::text,
    COUNT(*)::bigint,
    COALESCE(SUM(b.remaining), 0)::numeric
  FROM tx_bucketed b
  GROUP BY b.bucket;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_client_debt_buckets_range(date, date) TO authenticated;
