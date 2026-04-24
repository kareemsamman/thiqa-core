-- Period-scope the remaining KPIs so the top row reacts to the period
-- pill the same way every other card does:
--   * total_clients → clients created in the period (was all-time)
--   * cars_insured  → cars created in the period (was distinct cars
--                     referenced by policies created in the period;
--                     reframed to "new cars added" so the KPI is
--                     consistent with the clients one)
-- Policies count and period_profit already respect the period.

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
        AND (v_is_sa OR c.agent_id = v_agent_id))::bigint AS total_clients,
    (SELECT COUNT(*) FROM public.cars ca
      WHERE ca.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR ca.agent_id = v_agent_id))::bigint AS cars_insured,
    (SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
       FROM public.policies p
      WHERE p.cancelled = false AND p.deleted_at IS NULL
        AND p.created_at::date BETWEEN p_start_date AND p_end_date
        AND (v_is_sa OR p.agent_id = v_agent_id))::bigint AS policies_count,
    (
      COALESCE((
        SELECT SUM(COALESCE(p.profit, 0))
          FROM public.policies p
         WHERE p.cancelled = false AND p.deleted_at IS NULL
           AND p.policy_type_parent::text <> 'ELZAMI'
           AND p.start_date BETWEEN p_start_date AND p_end_date
           AND (v_is_sa OR p.agent_id = v_agent_id)
      ), 0)
      -
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
