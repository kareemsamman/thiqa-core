-- Dashboard v2: five new RPCs driving the redesigned dashboard.
--
-- Design rules applied across every RPC:
--   * Package policies (group_id IS NOT NULL) count as ONE transaction,
--     never as N rows. Uses COUNT(DISTINCT COALESCE(group_id::text, id::text)).
--   * Broker-arranged policies (broker_id IS NOT NULL) are excluded
--     from client-debt buckets — that money is owed by/to a broker,
--     not a client, so it must not inflate client debt totals.
--   * Agent scoping follows the same pattern as existing dashboard_*
--     RPCs: super admin sees global, regular users see their own agent.

-- 1) KPIs for the four top-row cards (clients / cars / policies / profit)
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
  v_is_sa boolean := false;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

  IF v_is_sa THEN
    RETURN QUERY
    SELECT
      (SELECT COUNT(*) FROM public.clients WHERE deleted_at IS NULL)::bigint,
      (SELECT COUNT(DISTINCT p.car_id) FROM public.policies p
        WHERE p.cancelled = false AND p.deleted_at IS NULL
          AND p.car_id IS NOT NULL
          AND p.created_at::date BETWEEN p_start_date AND p_end_date)::bigint,
      (SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
         FROM public.policies p
        WHERE p.cancelled = false AND p.deleted_at IS NULL
          AND p.created_at::date BETWEEN p_start_date AND p_end_date)::bigint,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN p.policy_type_parent::text = 'ELZAMI' THEN -COALESCE(p.elzami_cost, 0)
            ELSE COALESCE(p.profit, 0)
          END
        )
        FROM public.policies p
        WHERE p.cancelled = false AND p.deleted_at IS NULL
          AND p.start_date BETWEEN p_start_date AND p_end_date
      ), 0)::numeric;
    RETURN;
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.clients
      WHERE deleted_at IS NULL AND agent_id = v_agent_id)::bigint,
    (SELECT COUNT(DISTINCT p.car_id) FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.car_id IS NOT NULL
        AND p.agent_id = v_agent_id
        AND p.created_at::date BETWEEN p_start_date AND p_end_date)::bigint,
    (SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
       FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.agent_id = v_agent_id
        AND p.created_at::date BETWEEN p_start_date AND p_end_date)::bigint,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN p.policy_type_parent::text = 'ELZAMI' THEN -COALESCE(p.elzami_cost, 0)
          ELSE COALESCE(p.profit, 0)
        END
      )
      FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.agent_id = v_agent_id
        AND p.start_date BETWEEN p_start_date AND p_end_date
    ), 0)::numeric;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_kpis_v2(date, date) TO authenticated;


-- 2) Policies overview donut: active / expiring / expired / cancelled
--    Packages count as 1 transaction.
CREATE OR REPLACE FUNCTION public.dashboard_policies_overview()
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
  v_is_sa boolean := false;
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + INTERVAL '30 days';
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

  IF v_is_sa THEN
    RETURN QUERY
    WITH tx AS (
      SELECT
        COALESCE(p.group_id::text, p.id::text) AS tx_id,
        BOOL_OR(p.cancelled) AS any_cancelled,
        MAX(p.end_date) AS end_date
      FROM public.policies p
      WHERE p.deleted_at IS NULL
      GROUP BY COALESCE(p.group_id::text, p.id::text)
    )
    SELECT
      COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date >= v_today AND end_date > v_horizon)::bigint,
      COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date >= v_today AND end_date <= v_horizon)::bigint,
      COUNT(*) FILTER (WHERE NOT any_cancelled AND end_date < v_today)::bigint,
      COUNT(*) FILTER (WHERE any_cancelled)::bigint
    FROM tx;
    RETURN;
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  WITH tx AS (
    SELECT
      COALESCE(p.group_id::text, p.id::text) AS tx_id,
      BOOL_OR(p.cancelled) AS any_cancelled,
      MAX(p.end_date) AS end_date
    FROM public.policies p
    WHERE p.deleted_at IS NULL
      AND p.agent_id = v_agent_id
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

GRANT EXECUTE ON FUNCTION public.dashboard_policies_overview() TO authenticated;


-- 3) Client debt buckets by age — Panze-style colored bars.
--    Excludes broker-arranged policies. Packages count as 1.
--    Age = days since the newest policy start_date within the package.
CREATE OR REPLACE FUNCTION public.dashboard_client_debt_buckets()
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
  v_is_sa boolean := false;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

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
      AND (v_is_sa OR p.agent_id = v_agent_id)
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
    COUNT(*)::bigint AS tx_count,
    COALESCE(SUM(b.remaining), 0)::numeric AS amount
  FROM tx_bucketed b
  GROUP BY b.bucket;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_client_debt_buckets() TO authenticated;


-- 4) Monthly income-vs-expense time series for the line chart.
--    Income  = sum of insurance_price for non-ELZAMI policies (what we sold)
--    Expense = sum of elzami_cost for ELZAMI + payed_for_company for others
--    Bucketed by policy start_date into the last N calendar months.
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
  v_is_sa boolean := false;
  v_start date;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);
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
  policy_totals AS (
    SELECT
      date_trunc('month', p.start_date)::date AS month_start,
      SUM(CASE WHEN p.policy_type_parent::text <> 'ELZAMI' THEN COALESCE(p.insurance_price, 0) ELSE 0 END) AS income,
      SUM(
        CASE WHEN p.policy_type_parent::text = 'ELZAMI'
             THEN COALESCE(p.elzami_cost, 0)
             ELSE COALESCE(p.payed_for_company, 0)
        END
      ) AS expense
    FROM public.policies p
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.start_date >= v_start
      AND (v_is_sa OR p.agent_id = v_agent_id)
    GROUP BY date_trunc('month', p.start_date)
  )
  SELECT
    m.month_start::date AS month,
    COALESCE(pt.income, 0)::numeric AS income,
    COALESCE(pt.expense, 0)::numeric AS expense
  FROM months m
  LEFT JOIN policy_totals pt ON pt.month_start = m.month_start
  ORDER BY m.month_start;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_monthly(integer) TO authenticated;


-- 5) Top N insurance companies by production in period.
--    Package-aware transaction count. Ordered by total_amount desc.
CREATE OR REPLACE FUNCTION public.dashboard_top_companies(
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  tx_count bigint,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_is_sa boolean := false;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

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
    COALESCE(SUM(p.insurance_price), 0)::numeric AS total_amount
  FROM public.policies p
  JOIN public.insurance_companies ic ON ic.id = p.company_id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.created_at::date BETWEEN p_start_date AND p_end_date
    AND (v_is_sa OR (p.agent_id = v_agent_id AND ic.agent_id = v_agent_id))
  GROUP BY ic.id, ic.name_ar, ic.name
  ORDER BY total_amount DESC, tx_count DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_companies(date, date, integer) TO authenticated;
