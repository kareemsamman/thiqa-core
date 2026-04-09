
-- Update report_company_settlement to accept arrays
CREATE OR REPLACE FUNCTION public.report_company_settlement(
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_company_id uuid DEFAULT NULL::uuid,
  p_policy_type_parent policy_type_parent DEFAULT NULL::policy_type_parent,
  p_broker_id uuid DEFAULT NULL::uuid,
  p_include_cancelled boolean DEFAULT false,
  p_company_ids uuid[] DEFAULT NULL,
  p_policy_types text[] DEFAULT NULL,
  p_broker_ids uuid[] DEFAULT NULL
)
 RETURNS TABLE(company_id uuid, company_name text, company_name_ar text, policy_count bigint, total_insurance_price numeric, total_company_payment numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.company_id,
    ic.name AS company_name,
    ic.name_ar AS company_name_ar,
    COUNT(*)::bigint AS policy_count,
    COALESCE(SUM(p.insurance_price), 0)::numeric AS total_insurance_price,
    COALESCE(SUM(p.payed_for_company), 0)::numeric AS total_company_payment
  FROM policies p
  INNER JOIN insurance_companies ic ON ic.id = p.company_id
  WHERE p.deleted_at IS NULL
    AND p.company_id IS NOT NULL
    AND (p_start_date IS NULL OR p.start_date >= p_start_date)
    AND (p_end_date IS NULL OR p.start_date <= p_end_date)
    -- Legacy single param OR new array param
    AND (
      (p_company_id IS NULL AND p_company_ids IS NULL)
      OR p.company_id = p_company_id
      OR p.company_id = ANY(p_company_ids)
    )
    AND (
      (p_policy_type_parent IS NULL AND p_policy_types IS NULL)
      OR p.policy_type_parent = p_policy_type_parent
      OR p.policy_type_parent::text = ANY(p_policy_types)
    )
    AND (
      (p_broker_id IS NULL AND p_broker_ids IS NULL)
      OR p.broker_id = p_broker_id
      OR p.broker_id = ANY(p_broker_ids)
    )
    AND (p_include_cancelled = true OR COALESCE(p.cancelled, false) = false)
  GROUP BY p.company_id, ic.name, ic.name_ar
  ORDER BY ic.name_ar NULLS LAST, ic.name;
END;
$function$;

-- Update report_company_settlement_company_options to accept arrays
CREATE OR REPLACE FUNCTION public.report_company_settlement_company_options(
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_policy_type_parent policy_type_parent DEFAULT NULL::policy_type_parent,
  p_broker_id uuid DEFAULT NULL::uuid,
  p_policy_types text[] DEFAULT NULL,
  p_broker_ids uuid[] DEFAULT NULL
)
 RETURNS TABLE(company_id uuid, company_name text, company_name_ar text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    p.company_id,
    ic.name AS company_name,
    ic.name_ar AS company_name_ar
  FROM policies p
  INNER JOIN insurance_companies ic ON ic.id = p.company_id
  WHERE p.deleted_at IS NULL
    AND p.company_id IS NOT NULL
    AND (p_start_date IS NULL OR p.start_date >= p_start_date)
    AND (p_end_date IS NULL OR p.start_date <= p_end_date)
    AND (
      (p_policy_type_parent IS NULL AND p_policy_types IS NULL)
      OR p.policy_type_parent = p_policy_type_parent
      OR p.policy_type_parent::text = ANY(p_policy_types)
    )
    AND (
      (p_broker_id IS NULL AND p_broker_ids IS NULL)
      OR p.broker_id = p_broker_id
      OR p.broker_id = ANY(p_broker_ids)
    )
  ORDER BY ic.name_ar NULLS LAST, ic.name;
END;
$function$;
