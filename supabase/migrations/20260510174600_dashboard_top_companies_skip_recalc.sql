-- The accounting page (useAccountingData.ts) excludes policies with
-- skip_recalc = true from its totals — that flag is the user-facing
-- "skip this معاملة" toggle. The Top Companies dashboard widget was
-- aggregating profit straight from policies without the same filter,
-- so a company's bar/total was inflated by skipped transactions and
-- diverged from the accounting page totals.

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
    AND p.skip_recalc = false
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
