-- Drop all existing overloads of report_created_policies
DROP FUNCTION IF EXISTS public.report_created_policies(date, date, text, uuid, text, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.report_created_policies(date, date, uuid, text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.report_created_policies(date, date, integer, integer, text, uuid, text, uuid);

-- Recreate with single clean signature
CREATE OR REPLACE FUNCTION public.report_created_policies(
  p_start_date date,
  p_end_date date,
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1
)
RETURNS TABLE(
  id uuid,
  group_key text,
  is_package boolean,
  package_types text[],
  package_policy_ids uuid[],
  package_count integer,
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
  total_count bigint,
  package_companies text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer := (p_page - 1) * p_page_size;
BEGIN
  RETURN QUERY
  WITH grouped_policies AS (
    SELECT
      COALESCE(p.group_id::text, p.id::text) as grp_key,
      bool_or(p.group_id IS NOT NULL AND (
        SELECT count(*) FROM policies p2 WHERE p2.group_id = p.group_id AND p2.cancelled = false AND p2.deleted_at IS NULL
      ) > 1) as grp_is_package,
      ARRAY_AGG(DISTINCT 
        CASE 
          WHEN p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child IS NOT NULL 
            THEN p.policy_type_child::text
          ELSE p.policy_type_parent::text
        END
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
      (ARRAY_AGG(p.policy_type_child))[1] as grp_policy_type_child,
      (ARRAY_AGG(p.policy_number))[1] as grp_policy_number,
      min(p.start_date) as grp_start_date,
      max(p.end_date) as grp_end_date,
      sum(p.insurance_price) as grp_insurance_price,
      sum(COALESCE(p.profit, 0)) as grp_profit,
      min(p.created_at) as grp_created_at,
      (ARRAY_AGG(p.created_by_admin_id))[1] as grp_created_by,
      (ARRAY_AGG(pr.full_name))[1] as grp_created_by_name,
      (ARRAY_AGG(b.name_ar))[1] as grp_branch_name,
      ARRAY_AGG(DISTINCT COALESCE(ic.name_ar, ic.name)) FILTER (WHERE ic.name IS NOT NULL) as grp_company_names
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars cr ON cr.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles pr ON pr.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.created_at::date BETWEEN p_start_date AND p_end_date
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
    SELECT
      gp.*,
      COALESCE((
        SELECT sum(pp.amount) 
        FROM policy_payments pp 
        WHERE pp.policy_id = ANY(gp.grp_policy_ids) AND pp.refused = false
      ), 0) as grp_total_paid
    FROM grouped_policies gp
  ),
  counted AS (
    SELECT *, count(*) OVER () as cnt
    FROM with_payments
    ORDER BY grp_created_at DESC
    LIMIT p_page_size OFFSET v_offset
  )
  SELECT
    (ct.grp_policy_ids[1])::uuid as id,
    ct.grp_key as group_key,
    ct.grp_is_package as is_package,
    ct.grp_types as package_types,
    ct.grp_policy_ids as package_policy_ids,
    ct.grp_count as package_count,
    ct.grp_client_id as client_id,
    ct.grp_client_name as client_name,
    ct.grp_client_file_number as client_file_number,
    ct.grp_client_phone as client_phone,
    ct.grp_car_id as car_id,
    ct.grp_car_number as car_number,
    ct.grp_company_id as company_id,
    ct.grp_company_name as company_name,
    ct.grp_company_name_ar as company_name_ar,
    ct.grp_policy_type_parent as policy_type_parent,
    ct.grp_policy_type_child as policy_type_child,
    ct.grp_policy_number as policy_number,
    ct.grp_start_date as start_date,
    ct.grp_end_date as end_date,
    ct.grp_insurance_price as insurance_price,
    ct.grp_profit as profit,
    ct.grp_total_paid as total_paid,
    GREATEST(ct.grp_insurance_price - ct.grp_total_paid, 0) as remaining,
    CASE 
      WHEN ct.grp_total_paid >= ct.grp_insurance_price THEN 'paid'
      WHEN ct.grp_total_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END as payment_status,
    ct.grp_created_at as created_at,
    ct.grp_created_by as created_by_admin_id,
    ct.grp_created_by_name as created_by_name,
    ct.grp_branch_name as branch_name,
    ct.cnt as total_count,
    ct.grp_company_names as package_companies
  FROM counted ct;
END;
$$;