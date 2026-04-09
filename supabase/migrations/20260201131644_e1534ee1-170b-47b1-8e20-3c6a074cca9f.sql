-- Drop and recreate report_debt_policies_for_clients with correct parameter name and column aliases

DROP FUNCTION IF EXISTS public.report_debt_policies_for_clients(uuid[]);

CREATE OR REPLACE FUNCTION public.report_debt_policies_for_clients(p_client_ids uuid[])
RETURNS TABLE(
  policy_id uuid,
  client_id uuid,
  car_id uuid,
  car_number text,
  policy_type_parent text,
  policy_type_child text,
  company_name text,
  start_date date,
  end_date date,
  insurance_price numeric,
  total_paid numeric,
  remaining numeric,
  group_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH policy_payments_sum AS (
    SELECT 
      pp.policy_id,
      SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END) as paid_amount
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  package_totals AS (
    -- Calculate package-level totals for policies with group_id
    SELECT 
      p.group_id,
      p.client_id AS pkg_client,
      SUM(p.insurance_price)::numeric AS package_price,
      COALESCE(SUM(ps.paid_amount), 0)::numeric AS package_paid
    FROM policies p
    LEFT JOIN policy_payments_sum ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
    GROUP BY p.group_id, p.client_id
  ),
  policy_data AS (
    -- Package policies - distribute remaining proportionally
    SELECT 
      p.id AS pid,
      p.client_id AS pclient,
      p.car_id AS pcar,
      c.car_number AS pcar_number,
      p.policy_type_parent::text AS ptype_parent,
      p.policy_type_child::text AS ptype_child,
      ic.name AS pcompany,
      p.start_date::date AS pstart,
      p.end_date::date AS pend,
      p.insurance_price::numeric AS pprice,
      COALESCE(ps.paid_amount, 0)::numeric AS ppaid,
      -- For packages: calculate proportional remaining based on package totals
      CASE 
        WHEN pt.package_price > 0 THEN
          GREATEST(0, (p.insurance_price / pt.package_price) * (pt.package_price - pt.package_paid))
        ELSE 0
      END::numeric AS premaining,
      p.group_id AS pgroup,
      -- Mark as has_debt only if package has overall debt
      (pt.package_price - pt.package_paid) > 0 AS has_debt
    FROM policies p
    LEFT JOIN cars c ON c.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_payments_sum ps ON ps.policy_id = p.id
    JOIN package_totals pt ON pt.group_id = p.group_id AND pt.pkg_client = p.client_id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
    
    UNION ALL
    
    -- Single policies (no group_id) - calculate normally
    SELECT 
      p.id AS pid,
      p.client_id AS pclient,
      p.car_id AS pcar,
      c.car_number AS pcar_number,
      p.policy_type_parent::text AS ptype_parent,
      p.policy_type_child::text AS ptype_child,
      ic.name AS pcompany,
      p.start_date::date AS pstart,
      p.end_date::date AS pend,
      p.insurance_price::numeric AS pprice,
      COALESCE(ps.paid_amount, 0)::numeric AS ppaid,
      GREATEST(0, p.insurance_price - COALESCE(ps.paid_amount, 0))::numeric AS premaining,
      p.group_id AS pgroup,
      (p.insurance_price - COALESCE(ps.paid_amount, 0)) > 0 AS has_debt
    FROM policies p
    LEFT JOIN cars c ON c.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_payments_sum ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NULL
      AND p.client_id = ANY(p_client_ids)
  )
  SELECT 
    pd.pid AS policy_id,
    pd.pclient AS client_id,
    pd.pcar AS car_id,
    pd.pcar_number AS car_number,
    pd.ptype_parent AS policy_type_parent,
    pd.ptype_child AS policy_type_child,
    pd.pcompany AS company_name,
    pd.pstart AS start_date,
    pd.pend AS end_date,
    pd.pprice AS insurance_price,
    pd.ppaid AS total_paid,
    pd.premaining AS remaining,
    pd.pgroup AS group_id
  FROM policy_data pd
  WHERE pd.has_debt = true
  ORDER BY pd.pclient, pd.pgroup NULLS LAST, pd.pstart DESC;
END;
$$;