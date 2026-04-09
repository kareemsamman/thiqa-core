-- Server-side aggregation function for Company Settlement report
-- Avoids 1000 row limit by doing GROUP BY on server

CREATE OR REPLACE FUNCTION report_company_settlement(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_policy_type_parent policy_type_parent DEFAULT NULL,
  p_broker_id uuid DEFAULT NULL,
  p_include_cancelled boolean DEFAULT false
)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  company_name_ar text,
  policy_type policy_type_parent,
  policy_count bigint,
  total_insurance_price numeric,
  total_company_payment numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow admins to call this function
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.company_id,
    ic.name AS company_name,
    ic.name_ar AS company_name_ar,
    p.policy_type_parent AS policy_type,
    COUNT(*)::bigint AS policy_count,
    COALESCE(SUM(p.insurance_price), 0)::numeric AS total_insurance_price,
    COALESCE(SUM(p.payed_for_company), 0)::numeric AS total_company_payment
  FROM policies p
  INNER JOIN insurance_companies ic ON ic.id = p.company_id
  WHERE p.deleted_at IS NULL
    AND p.company_id IS NOT NULL
    -- Date filter (NULL = all time)
    AND (p_start_date IS NULL OR p.start_date >= p_start_date)
    AND (p_end_date IS NULL OR p.start_date <= p_end_date)
    -- Company filter
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    -- Policy type filter
    AND (p_policy_type_parent IS NULL OR p.policy_type_parent = p_policy_type_parent)
    -- Broker filter
    AND (p_broker_id IS NULL OR p.broker_id = p_broker_id)
    -- Cancelled filter
    AND (p_include_cancelled = true OR COALESCE(p.cancelled, false) = false)
  GROUP BY p.company_id, ic.name, ic.name_ar, p.policy_type_parent
  ORDER BY ic.name_ar NULLS LAST, ic.name;
END;
$$;

-- Function to get available companies for dropdown based on current filters
CREATE OR REPLACE FUNCTION report_company_settlement_company_options(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_policy_type_parent policy_type_parent DEFAULT NULL,
  p_broker_id uuid DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  company_name_ar text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow admins to call this function
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
    -- Date filter (NULL = all time)
    AND (p_start_date IS NULL OR p.start_date >= p_start_date)
    AND (p_end_date IS NULL OR p.start_date <= p_end_date)
    -- Policy type filter
    AND (p_policy_type_parent IS NULL OR p.policy_type_parent = p_policy_type_parent)
    -- Broker filter
    AND (p_broker_id IS NULL OR p.broker_id = p_broker_id)
  ORDER BY ic.name_ar NULLS LAST, ic.name;
END;
$$;