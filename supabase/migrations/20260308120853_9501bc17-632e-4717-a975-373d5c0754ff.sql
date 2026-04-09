-- Fix tenant isolation leaks in dashboard RPCs
-- Ensures agent users only see their own agent data, while super admins keep global visibility.

CREATE OR REPLACE FUNCTION public.dashboard_total_client_debt()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_agent_id uuid;
  v_is_sa boolean := false;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

  IF v_is_sa THEN
    SELECT COALESCE(SUM(gcb.total_remaining), 0)
    INTO v_total
    FROM public.clients c
    CROSS JOIN LATERAL public.get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND gcb.total_remaining > 0;

    RETURN COALESCE(v_total, 0);
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(gcb.total_remaining), 0)
  INTO v_total
  FROM public.clients c
  CROSS JOIN LATERAL public.get_client_balance(c.id) gcb
  WHERE c.deleted_at IS NULL
    AND c.agent_id = v_agent_id
    AND gcb.total_remaining > 0;

  RETURN COALESCE(v_total, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_insured_cars_count(p_start_date date, p_end_date date)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count bigint := 0;
  v_agent_id uuid;
  v_is_sa boolean := false;
BEGIN
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

  IF v_is_sa THEN
    SELECT COUNT(DISTINCT p.car_id)
    INTO v_count
    FROM public.policies p
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.car_id IS NOT NULL
      AND p.created_at::date BETWEEN p_start_date AND p_end_date;

    RETURN COALESCE(v_count, 0);
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(DISTINCT p.car_id)
  INTO v_count
  FROM public.policies p
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.car_id IS NOT NULL
    AND p.agent_id = v_agent_id
    AND p.created_at::date BETWEEN p_start_date AND p_end_date;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_company_production(p_start_date date, p_end_date date)
RETURNS TABLE(company_id uuid, company_name text, third_count bigint, third_amount numeric, full_count bigint, full_amount numeric, total_count bigint, total_amount numeric)
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
      ic.id as company_id,
      COALESCE(ic.name_ar, ic.name) as company_name,
      COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD') as third_count,
      COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD'), 0) as third_amount,
      COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL') as full_count,
      COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL'), 0) as full_amount,
      COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL') as total_count,
      COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL'), 0) as total_amount
    FROM public.policies p
    JOIN public.insurance_companies ic ON ic.id = p.company_id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.created_at::date BETWEEN p_start_date AND p_end_date
      AND p.policy_type_parent::text = 'THIRD_FULL'
    GROUP BY ic.id, ic.name_ar, ic.name
    ORDER BY total_count DESC;

    RETURN;
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ic.id as company_id,
    COALESCE(ic.name_ar, ic.name) as company_name,
    COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD') as third_count,
    COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD'), 0) as third_amount,
    COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL') as full_count,
    COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL'), 0) as full_amount,
    COUNT(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL') as total_count,
    COALESCE(SUM(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL'), 0) as total_amount
  FROM public.policies p
  JOIN public.insurance_companies ic ON ic.id = p.company_id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.agent_id = v_agent_id
    AND ic.agent_id = v_agent_id
    AND p.created_at::date BETWEEN p_start_date AND p_end_date
    AND p.policy_type_parent::text = 'THIRD_FULL'
  GROUP BY ic.id, ic.name_ar, ic.name
  ORDER BY total_count DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_company_debts()
RETURNS TABLE(company_id uuid, company_name text, outstanding numeric)
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
    SELECT ic.id, COALESCE(ic.name_ar, ic.name)::text, w.outstanding
    FROM public.insurance_companies ic
    CROSS JOIN LATERAL public.get_company_wallet_balance(ic.id, '2026-01-01'::date) w
    WHERE w.outstanding > 0
    ORDER BY w.outstanding DESC;

    RETURN;
  END IF;

  v_agent_id := public.get_user_agent_id(auth.uid());
  IF v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ic.id, COALESCE(ic.name_ar, ic.name)::text, w.outstanding
  FROM public.insurance_companies ic
  CROSS JOIN LATERAL public.get_company_wallet_balance(ic.id, '2026-01-01'::date) w
  WHERE ic.agent_id = v_agent_id
    AND w.outstanding > 0
  ORDER BY w.outstanding DESC;
END;
$function$;