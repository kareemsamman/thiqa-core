
CREATE OR REPLACE FUNCTION public.report_created_policies(
  p_start_date date,
  p_end_date date,
  p_created_by uuid DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size int DEFAULT 25,
  p_page int DEFAULT 1
)
RETURNS TABLE(
  id uuid,
  group_key text,
  is_package boolean,
  package_types text[],
  package_policy_ids uuid[],
  package_count int,
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  car_id uuid,
  car_number text,
  company_id uuid,
  company_name text,
  company_name_ar text,
  policy_type_parent text,
  policy_type_child text,
  policy_number text,
  start_date date,
  end_date date,
  insurance_price numeric,
  profit numeric,
  total_paid numeric,
  remaining numeric,
  payment_status text,
  created_at timestamptz,
  created_by_admin_id uuid,
  created_by_name text,
  branch_name text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_offset INT;
  v_total BIGINT;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  
  SELECT COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))
  INTO v_total
  FROM policies p
  JOIN clients c ON c.id = p.client_id
  LEFT JOIN cars ca ON ca.id = p.car_id
  LEFT JOIN insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN profiles pr ON pr.id = p.created_by_admin_id
  WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
    AND p.cancelled = false
    AND p.transferred = false
    AND (p_search IS NULL OR p_search = '' OR 
         c.full_name ILIKE '%' || p_search || '%' OR
         c.id_number ILIKE '%' || p_search || '%' OR
         c.phone_number ILIKE '%' || p_search || '%' OR
         ca.car_number ILIKE '%' || p_search || '%' OR
         p.policy_number ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    AND (p_policy_type IS NULL OR p_policy_type = '' OR p.policy_type_parent::text = p_policy_type)
    AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by);

  RETURN QUERY
  WITH grouped_policies AS (
    SELECT 
      COALESCE(p.group_id::text, p.id::text) as grp_key,
      ARRAY_AGG(DISTINCT 
        CASE 
          WHEN p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child IS NOT NULL 
            THEN p.policy_type_child::text
          ELSE p.policy_type_parent::text
        END
      ) as grp_types,
      ARRAY_AGG(p.id ORDER BY p.policy_type_parent) as grp_policy_ids,
      COUNT(*)::int as grp_count,
      (ARRAY_AGG(p.id ORDER BY p.policy_type_parent))[1] as first_policy_id,
      (ARRAY_AGG(p.client_id ORDER BY p.policy_type_parent))[1] as grp_client_id,
      (ARRAY_AGG(c.full_name ORDER BY p.policy_type_parent))[1] as grp_client_name,
      (ARRAY_AGG(c.file_number ORDER BY p.policy_type_parent))[1] as grp_client_file_number,
      (ARRAY_AGG(c.phone_number ORDER BY p.policy_type_parent))[1] as grp_client_phone,
      (ARRAY_AGG(p.car_id ORDER BY p.policy_type_parent))[1] as grp_car_id,
      (ARRAY_AGG(ca.car_number ORDER BY p.policy_type_parent))[1] as grp_car_number,
      (ARRAY_AGG(p.company_id ORDER BY p.policy_type_parent))[1] as grp_company_id,
      (ARRAY_AGG(ic.name ORDER BY p.policy_type_parent))[1] as grp_company_name,
      (ARRAY_AGG(ic.name_ar ORDER BY p.policy_type_parent))[1] as grp_company_name_ar,
      (ARRAY_AGG(p.policy_type_parent ORDER BY p.policy_type_parent))[1] as grp_policy_type_parent,
      (ARRAY_AGG(p.policy_type_child ORDER BY p.policy_type_parent))[1] as grp_policy_type_child,
      (ARRAY_AGG(p.policy_number ORDER BY p.policy_type_parent))[1] as grp_policy_number,
      MIN(p.start_date) as grp_start_date,
      MAX(p.end_date) as grp_end_date,
      SUM(COALESCE(p.insurance_price, 0)) as grp_insurance_price,
      SUM(COALESCE(p.profit, 0)) as grp_profit,
      MIN(p.created_at) as grp_created_at,
      (ARRAY_AGG(p.created_by_admin_id ORDER BY p.policy_type_parent))[1] as grp_created_by_admin_id,
      (ARRAY_AGG(pr.full_name ORDER BY p.policy_type_parent))[1] as grp_created_by_name,
      (ARRAY_AGG(b.name_ar ORDER BY p.policy_type_parent))[1] as grp_branch_name,
      (COUNT(*) > 1) as grp_is_package
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars ca ON ca.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles pr ON pr.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND p.cancelled = false
      AND p.transferred = false
      AND (p_search IS NULL OR p_search = '' OR 
           c.full_name ILIKE '%' || p_search || '%' OR
           c.id_number ILIKE '%' || p_search || '%' OR
           c.phone_number ILIKE '%' || p_search || '%' OR
           ca.car_number ILIKE '%' || p_search || '%' OR
           p.policy_number ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_policy_type IS NULL OR p_policy_type = '' OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
    GROUP BY COALESCE(p.group_id::text, p.id::text)
    ORDER BY grp_created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ),
  payment_totals AS (
    SELECT 
      COALESCE(pol.group_id::text, pol.id::text) as pay_grp_key,
      COALESCE(SUM(pp.amount), 0) as total_paid
    FROM policies pol
    LEFT JOIN policy_payments pp ON pp.policy_id = pol.id AND pp.refused = false
    WHERE pol.created_at::date BETWEEN p_start_date AND p_end_date
      AND pol.cancelled = false
      AND pol.transferred = false
    GROUP BY COALESCE(pol.group_id::text, pol.id::text)
  )
  SELECT
    gp.first_policy_id as id,
    gp.grp_key as group_key,
    gp.grp_is_package as is_package,
    gp.grp_types as package_types,
    gp.grp_policy_ids as package_policy_ids,
    gp.grp_count as package_count,
    gp.grp_client_id as client_id,
    gp.grp_client_name as client_name,
    gp.grp_client_file_number as client_file_number,
    gp.grp_client_phone as client_phone,
    gp.grp_car_id as car_id,
    gp.grp_car_number as car_number,
    gp.grp_company_id as company_id,
    gp.grp_company_name as company_name,
    gp.grp_company_name_ar as company_name_ar,
    gp.grp_policy_type_parent::text as policy_type_parent,
    gp.grp_policy_type_child::text as policy_type_child,
    gp.grp_policy_number as policy_number,
    gp.grp_start_date as start_date,
    gp.grp_end_date as end_date,
    gp.grp_insurance_price as insurance_price,
    gp.grp_profit as profit,
    COALESCE(pt.total_paid, 0) as total_paid,
    gp.grp_insurance_price - COALESCE(pt.total_paid, 0) as remaining,
    CASE 
      WHEN COALESCE(pt.total_paid, 0) >= gp.grp_insurance_price THEN 'paid'
      WHEN COALESCE(pt.total_paid, 0) > 0 THEN 'partial'
      ELSE 'unpaid'
    END as payment_status,
    gp.grp_created_at as created_at,
    gp.grp_created_by_admin_id as created_by_admin_id,
    gp.grp_created_by_name as created_by_name,
    gp.grp_branch_name as branch_name,
    v_total as total_count;
END;
$$;
