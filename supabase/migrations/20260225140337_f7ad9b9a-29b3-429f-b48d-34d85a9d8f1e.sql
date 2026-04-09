-- Dashboard: company production breakdown (THIRD/FULL only, no ELZAMI)
CREATE OR REPLACE FUNCTION public.dashboard_company_production(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  third_count bigint,
  third_amount numeric,
  full_count bigint,
  full_amount numeric,
  total_count bigint,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ic.id as company_id,
    COALESCE(ic.name_ar, ic.name) as company_name,
    count(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD') as third_count,
    COALESCE(sum(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND COALESCE(p.policy_type_child::text, 'THIRD') = 'THIRD'), 0) as third_amount,
    count(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL') as full_count,
    COALESCE(sum(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child::text = 'FULL'), 0) as full_amount,
    count(*) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL') as total_count,
    COALESCE(sum(p.insurance_price) FILTER (WHERE p.policy_type_parent::text = 'THIRD_FULL'), 0) as total_amount
  FROM policies p
  JOIN insurance_companies ic ON ic.id = p.company_id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.created_at::date BETWEEN p_start_date AND p_end_date
    AND p.policy_type_parent::text = 'THIRD_FULL'
  GROUP BY ic.id, ic.name_ar, ic.name
  ORDER BY total_count DESC;
END;
$$;

-- Dashboard: total client debt
CREATE OR REPLACE FUNCTION public.dashboard_total_client_debt()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  SELECT COALESCE(sum(
    CASE
      WHEN p.policy_type_parent::text = 'ELZAMI' THEN COALESCE(p.office_commission, 0)
      ELSE p.insurance_price + COALESCE(p.office_commission, 0)
    END
  ), 0) - COALESCE((
    SELECT sum(pp.amount) FROM policy_payments pp
    JOIN policies pol ON pol.id = pp.policy_id
    WHERE pol.cancelled = false AND pol.deleted_at IS NULL
      AND pol.broker_id IS NULL AND pp.refused = false
  ), 0) - COALESCE((
    SELECT sum(wt.amount) FROM customer_wallet_transactions wt
    WHERE wt.transaction_type = 'refund'
  ), 0)
  INTO v_total
  FROM policies p
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.broker_id IS NULL;
  
  RETURN GREATEST(v_total, 0);
END;
$$;

-- Dashboard: insured cars count for a period
CREATE OR REPLACE FUNCTION public.dashboard_insured_cars_count(
  p_start_date date,
  p_end_date date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(DISTINCT p.car_id)
  INTO v_count
  FROM policies p
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.car_id IS NOT NULL
    AND p.created_at::date BETWEEN p_start_date AND p_end_date;
  
  RETURN v_count;
END;
$$;