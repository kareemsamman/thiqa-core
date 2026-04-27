-- ============================================================
-- Follow-up to 20260427120100 — add the missing expense branch
-- filter to the three dashboard RPCs that read public.expenses.
--
-- Background: expenses.branch_id has existed since the original
-- CREATE TABLE (20260109134153). The previous migration's header
-- mistakenly claimed otherwise and skipped branch-filtering the
-- expense subqueries, so a branch-scoped user saw their branch's
-- income against the agent's total expenses. This migration
-- corrects that — every expense subquery now applies the same
-- (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
-- guard the policy / income side already use.
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
      COALESCE((
        SELECT SUM(COALESCE(e.amount, 0))
          FROM public.expenses e
         WHERE e.voucher_type = 'payment'
           AND e.expense_date BETWEEN p_start_date AND p_end_date
           AND (v_is_sa OR e.agent_id = v_agent_id)
           AND (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
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
       AND (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
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
         AND (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
    ), 0)::numeric AS expense;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_totals(date, date) TO authenticated;
