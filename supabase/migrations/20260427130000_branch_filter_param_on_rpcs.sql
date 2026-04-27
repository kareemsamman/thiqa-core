-- ============================================================
-- Add an optional p_branch_id parameter to every RPC the agent app
-- calls from a page that wants a branch-filter dropdown.
--
-- Behavior:
--   p_branch_id IS NULL  → no extra filter (caller's natural scope
--                          via can_see_all_branches / branch_isolation
--                          still applies — branch-scoped users keep
--                          seeing only their branch).
--   p_branch_id IS NOT NULL → narrows the result to that branch on top
--                             of the existing scope. A branch-scoped
--                             user who somehow passes another branch's
--                             id gets nothing back, because their own
--                             branch filter still applies underneath.
--
-- Adding a parameter changes the function signature, so each is
-- DROP'd + recreated. PostgreSQL DDL is transactional — there's no
-- window where the function is missing for users mid-migration.
-- ============================================================

-- ---------- Dashboard ---------------------------------------

DROP FUNCTION IF EXISTS public.dashboard_kpis_v2(date, date);

CREATE OR REPLACE FUNCTION public.dashboard_kpis_v2(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
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
        AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
    )::bigint AS total_clients,
    (SELECT COUNT(*) FROM public.cars ca
      WHERE ca.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR ca.agent_id = v_agent_id)
        AND (v_see_all OR ca.branch_id IS NULL OR ca.branch_id = v_my_branch)
        AND (p_branch_id IS NULL OR ca.branch_id = p_branch_id)
    )::bigint AS cars_insured,
    (SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
       FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR p.agent_id = v_agent_id)
        AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
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
           AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      ), 0)
      -
      COALESCE((
        SELECT SUM(COALESCE(e.amount, 0))
          FROM public.expenses e
         WHERE e.voucher_type = 'payment'
           AND e.expense_date BETWEEN p_start_date AND p_end_date
           AND (v_is_sa OR e.agent_id = v_agent_id)
           AND (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
           AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      ), 0)
    )::numeric AS period_profit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_kpis_v2(date, date, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_income_expense_monthly(integer);

CREATE OR REPLACE FUNCTION public.dashboard_income_expense_monthly(
  p_months integer DEFAULT 6,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(month date, income numeric, expense numeric)
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
       AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
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
       AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
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

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_monthly(integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_income_expense_totals(date, date);

CREATE OR REPLACE FUNCTION public.dashboard_income_expense_totals(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
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
         AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    ), 0)::numeric AS income,
    COALESCE((
      SELECT SUM(COALESCE(e.amount, 0))
        FROM public.expenses e
       WHERE e.voucher_type = 'payment'
         AND e.expense_date BETWEEN p_start_date AND p_end_date
         AND (v_is_sa OR e.agent_id = v_agent_id)
         AND (v_see_all OR e.branch_id IS NULL OR e.branch_id = v_my_branch)
         AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
    ), 0)::numeric AS expense;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_income_expense_totals(date, date, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_top_companies(date, date, integer);

CREATE OR REPLACE FUNCTION public.dashboard_top_companies(
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 5,
  p_branch_id uuid DEFAULT NULL
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
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
  GROUP BY ic.id, ic.name_ar, ic.name
  HAVING COALESCE(SUM(COALESCE(p.profit, 0)), 0) <> 0
  ORDER BY total_profit DESC, tx_count DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_companies(date, date, integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_policies_overview_range(date, date);

CREATE OR REPLACE FUNCTION public.dashboard_policies_overview_range(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
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
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
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

GRANT EXECUTE ON FUNCTION public.dashboard_policies_overview_range(date, date, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.dashboard_client_debt_buckets_range(date, date);

CREATE OR REPLACE FUNCTION public.dashboard_client_debt_buckets_range(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(bucket text, tx_count bigint, amount numeric)
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
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
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

GRANT EXECUTE ON FUNCTION public.dashboard_client_debt_buckets_range(date, date, uuid) TO authenticated;


-- ---------- Reports (PolicyReports page) -----------------

DROP FUNCTION IF EXISTS public.report_renewals(date, date, text, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.report_renewals(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  policies_count integer,
  earliest_end_date date,
  days_remaining integer,
  total_insurance_price numeric,
  policy_types text[],
  policy_ids uuid[],
  car_numbers text[],
  worst_renewal_status text,
  renewal_notes text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH client_policies AS (
    SELECT
      c.id as cid, c.full_name as cname, c.file_number as cfile, c.phone_number as cphone,
      p.id as pid, p.end_date, p.insurance_price, p.policy_type_parent,
      COALESCE(prt.renewal_status, 'not_contacted') as rstatus,
      prt.notes as rnotes, car.car_number as car_num
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND p.end_date >= COALESCE(p_start_date, p.end_date)
      AND p.end_date <= COALESCE(p_end_date, p.end_date)
      AND (NULLIF(p_policy_type, '') IS NULL OR p.policy_type_parent::text = NULLIF(p_policy_type, ''))
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR car.car_number ILIKE '%' || p_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.deleted_at IS NULL
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      )
  ),
  aggregated AS (
    SELECT
      cp.cid, cp.cname, cp.cfile, cp.cphone,
      COUNT(*)::integer as pcount,
      MIN(cp.end_date) as min_end,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(COALESCE(cp.insurance_price, 0)) as total_price,
      ARRAY_AGG(DISTINCT cp.policy_type_parent::text) FILTER (WHERE cp.policy_type_parent IS NOT NULL) as ptypes,
      ARRAY_AGG(cp.pid) as pids,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      CASE
        WHEN bool_or(cp.rstatus = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(cp.rstatus = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(cp.rstatus = 'called') THEN 'called'
        WHEN bool_or(cp.rstatus = 'not_interested') THEN 'not_interested'
        ELSE 'renewed'
      END as worst_status,
      STRING_AGG(cp.rnotes, '; ') FILTER (WHERE cp.rnotes IS NOT NULL) as notes_agg
    FROM client_policies cp
    GROUP BY cp.cid, cp.cname, cp.cfile, cp.cphone
  ),
  counted AS (SELECT COUNT(*) OVER() as total FROM aggregated)
  SELECT
    a.cid, a.cname, a.cfile, a.cphone, a.pcount, a.min_end, a.days_rem,
    a.total_price, a.ptypes, a.pids, a.car_nums, a.worst_status, a.notes_agg,
    (SELECT total FROM counted LIMIT 1)
  FROM aggregated a
  ORDER BY a.min_end ASC
  LIMIT p_page_size OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_renewals(date, date, text, uuid, text, integer, integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.report_created_policies(date, date, text, uuid, text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.report_created_policies(
  p_start_date date,
  p_end_date date,
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, group_key text, is_package boolean, package_types text[],
  package_policy_ids uuid[], package_count integer, client_id uuid,
  client_name text, client_file_number text, client_phone text,
  car_id uuid, car_number text, company_id uuid, company_name text,
  company_name_ar text, policy_type_parent text, policy_type_child text,
  policy_number text, start_date date, end_date date,
  insurance_price numeric, profit numeric, total_paid numeric,
  remaining numeric, payment_status text, created_at timestamptz,
  created_by_admin_id uuid, created_by_name text, branch_name text,
  total_count bigint, package_companies text[], package_service_names text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer := (p_page - 1) * p_page_size;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH grouped_policies AS (
    SELECT
      COALESCE(p.group_id::text, p.id::text) as grp_key,
      bool_or(p.group_id IS NOT NULL AND (
        SELECT count(*) FROM policies p2
         WHERE p2.group_id = p.group_id
           AND p2.cancelled = false
           AND p2.deleted_at IS NULL
           AND (v_is_sa OR p2.agent_id = v_agent_id)
      ) > 1) as grp_is_package,
      ARRAY_AGG(DISTINCT
        CASE WHEN p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child IS NOT NULL
            THEN p.policy_type_child::text ELSE p.policy_type_parent::text END
      ) as grp_types,
      ARRAY_AGG(DISTINCT p.id) as grp_policy_ids,
      count(DISTINCT p.id)::integer as grp_count,
      (ARRAY_AGG(p.client_id))[1] as grp_client_id,
      (ARRAY_AGG(c.full_name))[1] as grp_client_name,
      (ARRAY_AGG(c.file_number))[1] as grp_client_file_number,
      (ARRAY_AGG(c.phone_number))[1] as grp_client_phone,
      (ARRAY_AGG(p.car_id))[1] as grp_car_id,
      (ARRAY_AGG(cr.car_number))[1] as grp_car_number,
      (ARRAY_AGG(p.company_id))[1] as grp_company_id,
      (ARRAY_AGG(ic.name))[1] as grp_company_name,
      (ARRAY_AGG(ic.name_ar))[1] as grp_company_name_ar,
      (ARRAY_AGG(p.policy_type_parent::text))[1] as grp_policy_type_parent,
      (ARRAY_AGG(p.policy_type_child::text))[1] as grp_policy_type_child,
      (ARRAY_AGG(p.policy_number))[1] as grp_policy_number,
      min(p.start_date) as grp_start_date,
      max(p.end_date) as grp_end_date,
      sum(p.insurance_price) as grp_insurance_price,
      sum(COALESCE(p.profit, 0)) as grp_profit,
      min(p.created_at) as grp_created_at,
      (ARRAY_AGG(p.created_by_admin_id))[1] as grp_created_by,
      (ARRAY_AGG(pr.full_name))[1] as grp_created_by_name,
      (ARRAY_AGG(b.name_ar))[1] as grp_branch_name,
      ARRAY_AGG(DISTINCT COALESCE(ic.name_ar, ic.name)) FILTER (WHERE ic.name IS NOT NULL) as grp_company_names,
      ARRAY_AGG(DISTINCT COALESCE(rs.name_ar, rs.name)) FILTER (WHERE rs.id IS NOT NULL) as grp_road_service_names,
      ARRAY_AGG(DISTINCT COALESCE(afs.name_ar, afs.name)) FILTER (WHERE afs.id IS NOT NULL) as grp_accident_fee_names
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars cr ON cr.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles pr ON pr.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN road_services rs ON rs.id = p.road_service_id
    LEFT JOIN accident_fee_services afs ON afs.id = p.accident_fee_service_id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.created_at::date BETWEEN p_start_date AND p_end_date
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR
           c.full_name ILIKE '%' || p_search || '%' OR
           c.phone_number ILIKE '%' || p_search || '%' OR
           c.id_number ILIKE '%' || p_search || '%' OR
           c.file_number ILIKE '%' || p_search || '%' OR
           cr.car_number ILIKE '%' || p_search || '%' OR
           p.policy_number ILIKE '%' || p_search || '%')
    GROUP BY COALESCE(p.group_id::text, p.id::text)
  ),
  with_payments AS (
    SELECT gp.*,
      COALESCE((
        SELECT sum(pp.amount) FROM policy_payments pp
        WHERE pp.policy_id = ANY(gp.grp_policy_ids) AND pp.refused = false
      ), 0) as grp_total_paid
    FROM grouped_policies gp
  ),
  counted AS (
    SELECT *, count(*) OVER () as cnt FROM with_payments
    ORDER BY grp_created_at DESC LIMIT p_page_size OFFSET v_offset
  )
  SELECT
    (ct.grp_policy_ids[1])::uuid, ct.grp_key, ct.grp_is_package, ct.grp_types,
    ct.grp_policy_ids, ct.grp_count, ct.grp_client_id, ct.grp_client_name,
    ct.grp_client_file_number, ct.grp_client_phone, ct.grp_car_id,
    ct.grp_car_number, ct.grp_company_id, ct.grp_company_name,
    ct.grp_company_name_ar, ct.grp_policy_type_parent, ct.grp_policy_type_child,
    ct.grp_policy_number, ct.grp_start_date, ct.grp_end_date,
    ct.grp_insurance_price, ct.grp_profit, ct.grp_total_paid,
    GREATEST(ct.grp_insurance_price - ct.grp_total_paid, 0),
    CASE WHEN ct.grp_total_paid >= ct.grp_insurance_price THEN 'paid'
         WHEN ct.grp_total_paid > 0 THEN 'partial'
         ELSE 'unpaid' END,
    ct.grp_created_at, ct.grp_created_by, ct.grp_created_by_name,
    ct.grp_branch_name, ct.cnt, ct.grp_company_names,
    ARRAY(SELECT unnest FROM (
      SELECT unnest(ct.grp_road_service_names)
      UNION SELECT unnest(ct.grp_accident_fee_names)
    ) sub)
  FROM counted ct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_created_policies(date, date, text, uuid, text, uuid, integer, integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.report_renewed_clients(text, text, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.report_renewed_clients(
  p_end_month text DEFAULT NULL::text,
  p_policy_type text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid, client_name text, client_file_number text, client_phone text,
  policies_count bigint, earliest_end_date date, total_insurance_price numeric,
  policy_types text[], policy_ids uuid[], new_policies_count bigint,
  new_policy_ids uuid[], new_policy_types text[], new_total_price numeric,
  new_start_date date, has_package boolean, renewed_by_admin_id uuid,
  renewed_by_name text, total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start date;
  v_month_end date;
  v_policy_type public.policy_type_parent;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  IF p_end_month IS NOT NULL AND p_end_month != '' THEN
    v_month_start := date_trunc('month', p_end_month::date);
    v_month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  ELSE
    v_month_start := date_trunc('month', CURRENT_DATE);
    v_month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  END IF;

  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;

  RETURN QUERY
  WITH expiring_policies AS (
    SELECT p.id, p.client_id, p.car_id, p.policy_type_parent AS ptype,
           p.group_id, p.insurance_price, p.end_date, p.start_date
    FROM policies p
    WHERE p.end_date BETWEEN v_month_start AND v_month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR EXISTS (
          SELECT 1 FROM clients c WHERE c.id = p.client_id
            AND (v_is_sa OR c.agent_id = v_agent_id)
            AND (c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%'
              OR c.file_number ILIKE '%' || p_search || '%')
        ))
      AND EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
          AND newer.cancelled = false AND newer.transferred = false AND newer.deleted_at IS NULL
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      )
  ),
  renewal_mappings AS (
    SELECT DISTINCT ON (ep.id)
      ep.id AS old_policy_id, ep.client_id, np.id AS new_policy_id,
      np.policy_type_parent AS new_ptype, np.insurance_price AS new_price,
      np.start_date AS new_start, np.group_id AS new_group_id,
      np.created_by_admin_id AS renewed_by
    FROM expiring_policies ep
    JOIN policies np ON np.client_id = ep.client_id
      AND np.car_id IS NOT DISTINCT FROM ep.car_id
      AND np.policy_type_parent = ep.ptype
      AND np.start_date > ep.start_date
      AND np.end_date > CURRENT_DATE
      AND np.cancelled = false AND np.transferred = false AND np.deleted_at IS NULL
      AND (v_is_sa OR np.agent_id = v_agent_id)
    ORDER BY ep.id, np.start_date ASC
  ),
  client_aggregates AS (
    SELECT ep.client_id, c.full_name AS client_name,
      c.file_number AS client_file_number, c.phone_number AS client_phone,
      COUNT(DISTINCT ep.id) AS policies_count,
      MIN(ep.end_date) AS earliest_end_date,
      COALESCE(SUM(ep.insurance_price), 0) AS total_insurance_price,
      ARRAY_AGG(DISTINCT ep.ptype::text) AS policy_types,
      ARRAY_AGG(DISTINCT ep.id) AS policy_ids,
      COUNT(DISTINCT rm.new_policy_id) AS new_policies_count,
      ARRAY_AGG(DISTINCT rm.new_policy_id) FILTER (WHERE rm.new_policy_id IS NOT NULL) AS new_policy_ids,
      ARRAY_AGG(DISTINCT rm.new_ptype::text) FILTER (WHERE rm.new_ptype IS NOT NULL) AS new_policy_types,
      COALESCE(SUM(DISTINCT rm.new_price) FILTER (WHERE rm.new_policy_id IS NOT NULL), 0) AS new_total_price,
      MIN(rm.new_start) AS new_start_date,
      bool_or(ep.group_id IS NOT NULL OR rm.new_group_id IS NOT NULL) AS has_package,
      (ARRAY_AGG(rm.renewed_by ORDER BY rm.new_start ASC) FILTER (WHERE rm.renewed_by IS NOT NULL))[1] AS renewed_by_admin_id
    FROM expiring_policies ep
    JOIN clients c ON c.id = ep.client_id
    LEFT JOIN renewal_mappings rm ON rm.old_policy_id = ep.id
    WHERE (v_is_sa OR c.agent_id = v_agent_id)
    GROUP BY ep.client_id, c.full_name, c.file_number, c.phone_number
  )
  SELECT ca.client_id, ca.client_name, ca.client_file_number, ca.client_phone,
    ca.policies_count, ca.earliest_end_date, ca.total_insurance_price,
    ca.policy_types, ca.policy_ids, ca.new_policies_count, ca.new_policy_ids,
    ca.new_policy_types, ca.new_total_price, ca.new_start_date, ca.has_package,
    ca.renewed_by_admin_id, pr.full_name AS renewed_by_name,
    COUNT(*) OVER()::bigint AS total_count
  FROM client_aggregates ca
  LEFT JOIN profiles pr ON pr.id = ca.renewed_by_admin_id
  ORDER BY ca.earliest_end_date ASC, ca.client_name
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_renewed_clients(text, text, uuid, text, integer, integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.report_renewals_summary(text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month text DEFAULT NULL::text,
  p_policy_type text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  total_expiring bigint, not_contacted bigint, sms_sent bigint, called bigint,
  renewed bigint, not_interested bigint, total_packages bigint,
  total_single bigint, total_value numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  month_start date; month_end date;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF p_end_month IS NULL THEN
    month_start := date_trunc('month', CURRENT_DATE)::date;
    month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  ELSE
    month_start := date_trunc('month', p_end_month::date)::date;
    month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  END IF;

  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  WITH expiring_policies AS (
    SELECT p.id, p.client_id, p.group_id, p.insurance_price, p.policy_type_parent,
      EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false AND newer.transferred = false
          AND newer.start_date > p.start_date AND newer.end_date > CURRENT_DATE
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      ) AS is_auto_renewed,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
    FROM policies p
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR EXISTS (
          SELECT 1 FROM clients c WHERE c.id = p.client_id
            AND (v_is_sa OR c.agent_id = v_agent_id)
            AND (c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%')
        ))
  ),
  policies_with_status AS (
    SELECT ep.id, ep.client_id, ep.group_id, ep.insurance_price,
      CASE WHEN ep.is_auto_renewed THEN 'renewed' ELSE ep.renewal_status END AS final_status,
      ep.group_id IS NOT NULL AS has_package
    FROM expiring_policies ep
  ),
  client_statuses AS (
    SELECT pws.client_id,
      CASE
        WHEN bool_or(pws.final_status = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(pws.final_status = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(pws.final_status = 'called') THEN 'called'
        WHEN bool_or(pws.final_status = 'renewed') THEN 'renewed'
        WHEN bool_or(pws.final_status = 'not_interested') THEN 'not_interested'
        ELSE 'not_contacted'
      END AS status,
      bool_or(pws.has_package) AS has_package,
      SUM(pws.insurance_price) AS total_value
    FROM policies_with_status pws GROUP BY pws.client_id
  )
  SELECT
    COUNT(*)::bigint AS total_expiring,
    COUNT(*) FILTER (WHERE cs.status = 'not_contacted')::bigint AS not_contacted,
    COUNT(*) FILTER (WHERE cs.status = 'sms_sent')::bigint AS sms_sent,
    COUNT(*) FILTER (WHERE cs.status = 'called')::bigint AS called,
    COUNT(*) FILTER (WHERE cs.status = 'renewed')::bigint AS renewed,
    COUNT(*) FILTER (WHERE cs.status = 'not_interested')::bigint AS not_interested,
    COUNT(*) FILTER (WHERE cs.has_package AND cs.status != 'renewed')::bigint AS total_packages,
    COUNT(*) FILTER (WHERE NOT cs.has_package AND cs.status != 'renewed')::bigint AS total_single,
    COALESCE(SUM(cs.total_value) FILTER (WHERE cs.status != 'renewed'), 0)::numeric AS total_value
  FROM client_statuses cs;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_renewals_summary(text, text, uuid, text, uuid) TO authenticated;


-- ---------- Debt tracking --------------------------------

DROP FUNCTION IF EXISTS public.report_client_debts(text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid, client_name text, client_phone text,
  total_insurance numeric, total_paid numeric, total_refunds numeric,
  total_remaining numeric, oldest_end_date date, days_until_oldest integer,
  policies_count integer, total_rows bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(DISTINCT c.id)
  INTO v_total_count
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND (v_is_sa OR c.agent_id = v_agent_id)
    AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
    AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
    AND (p_search IS NULL
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
      OR c.id_number ILIKE '%' || p_search || '%')
    AND EXISTS (SELECT 1 FROM get_client_balance(c.id) gcb WHERE gcb.total_remaining > 0);

  RETURN QUERY
  WITH client_balances AS (
    SELECT c.id AS cid, c.full_name AS cname, c.phone_number AS cphone,
      gcb.total_insurance, gcb.total_paid, gcb.total_refunds, gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      AND gcb.total_remaining > 0
      AND (p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%')
  ),
  policy_dates AS (
    SELECT cb.cid, MIN(p.end_date)::date AS oldest_end,
      COUNT(p.id)::integer AS pol_count
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    GROUP BY cb.cid
  ),
  combined AS (
    SELECT cb.cid, cb.cname, cb.cphone, cb.total_insurance, cb.total_paid,
      cb.total_refunds, cb.total_remaining, pd.oldest_end, pd.pol_count
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (p_filter_days IS NULL
      OR pd.oldest_end IS NULL
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days)
  )
  SELECT c.cid, c.cname, c.cphone, c.total_insurance, c.total_paid,
    c.total_refunds, c.total_remaining, c.oldest_end,
    CASE WHEN c.oldest_end IS NULL THEN NULL
      ELSE (c.oldest_end - CURRENT_DATE)::integer END,
    COALESCE(c.pol_count, 0), v_total_count
  FROM combined c
  ORDER BY c.total_remaining DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_client_debts(text, integer, integer, integer, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.report_client_debts_summary(text, integer);

CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL::text,
  p_filter_days integer DEFAULT NULL::integer,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(total_clients bigint, total_remaining numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  WITH client_balances AS (
    SELECT c.id AS cid, gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      AND gcb.total_remaining > 0
      AND (p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%')
  ),
  policy_dates AS (
    SELECT cb.cid, MIN(p.end_date)::date AS oldest_end
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    GROUP BY cb.cid
  ),
  combined AS (
    SELECT cb.cid, cb.total_remaining
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (p_filter_days IS NULL
      OR pd.oldest_end IS NULL
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days)
  )
  SELECT COUNT(*)::bigint AS total_clients,
    COALESCE(SUM(c.total_remaining), 0)::numeric AS total_remaining
  FROM combined c;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_client_debts_summary(text, integer, uuid) TO authenticated;
