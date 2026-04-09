
-- Drop and recreate functions with new return types

DROP FUNCTION IF EXISTS public.report_created_policies(date, date, uuid, text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.report_renewals(date, integer, text, uuid, text, integer, integer);

-- Create report_created_policies with package grouping
CREATE FUNCTION public.report_created_policies(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_created_by uuid DEFAULT NULL::uuid, 
  p_policy_type text DEFAULT NULL::text, 
  p_company_id uuid DEFAULT NULL::uuid, 
  p_search text DEFAULT NULL::text, 
  p_limit integer DEFAULT 25, 
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, 
  created_at timestamp with time zone, 
  created_by_id uuid, 
  created_by_name text, 
  created_by_phone text, 
  branch_name text, 
  client_id uuid, 
  client_name text, 
  client_file_number text, 
  client_phone text, 
  car_number text, 
  policy_type_parent text, 
  policy_type_child text, 
  company_name text, 
  company_name_ar text, 
  start_date date, 
  end_date date, 
  insurance_price numeric, 
  total_paid numeric, 
  remaining numeric, 
  payment_status text, 
  total_rows bigint,
  is_package boolean,
  package_types text[],
  package_policy_ids uuid[],
  package_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH policy_payments_agg AS (
    SELECT 
      pp.policy_id,
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS total_paid
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  base_policies AS (
    SELECT
      p.id,
      p.created_at,
      p.created_by_admin_id,
      prof.full_name AS created_by_name,
      prof.phone AS created_by_phone,
      b.name_ar AS branch_name,
      p.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      car.car_number,
      p.policy_type_parent::TEXT,
      p.policy_type_child::TEXT,
      ic.name AS company_name,
      ic.name_ar AS company_name_ar,
      p.start_date,
      p.end_date,
      p.insurance_price,
      COALESCE(ppa.total_paid, 0) AS total_paid,
      p.group_id
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles prof ON prof.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN policy_payments_agg ppa ON ppa.policy_id = p.id
    WHERE p.deleted_at IS NULL
      AND can_access_branch(auth.uid(), p.branch_id)
      AND (p_from_date IS NULL OR p.created_at::DATE >= p_from_date)
      AND (p_to_date IS NULL OR p.created_at::DATE <= p_to_date)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (
        p_search IS NULL OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone_number ILIKE '%' || p_search || '%' OR
        c.id_number ILIKE '%' || p_search || '%' OR
        c.file_number ILIKE '%' || p_search || '%' OR
        car.car_number ILIKE '%' || p_search || '%'
      )
  ),
  grouped_policies AS (
    SELECT
      MIN(bp.id) AS id,
      MIN(bp.created_at) AS created_at,
      (array_agg(bp.created_by_admin_id))[1] AS created_by_id,
      (array_agg(bp.created_by_name))[1] AS created_by_name,
      (array_agg(bp.created_by_phone))[1] AS created_by_phone,
      (array_agg(bp.branch_name))[1] AS branch_name,
      (array_agg(bp.client_id))[1] AS client_id,
      (array_agg(bp.client_name))[1] AS client_name,
      (array_agg(bp.client_file_number))[1] AS client_file_number,
      (array_agg(bp.client_phone))[1] AS client_phone,
      (array_agg(bp.car_number))[1] AS car_number,
      CASE 
        WHEN bp.group_id IS NOT NULL THEN 'PACKAGE'
        ELSE (array_agg(bp.policy_type_parent))[1]
      END AS policy_type_parent,
      (array_agg(bp.policy_type_child))[1] AS policy_type_child,
      (array_agg(bp.company_name))[1] AS company_name,
      (array_agg(bp.company_name_ar))[1] AS company_name_ar,
      MIN(bp.start_date) AS start_date,
      MAX(bp.end_date) AS end_date,
      SUM(bp.insurance_price) AS insurance_price,
      SUM(bp.total_paid) AS total_paid,
      bp.group_id,
      CASE WHEN bp.group_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_package,
      ARRAY_AGG(DISTINCT bp.policy_type_parent ORDER BY bp.policy_type_parent) AS package_types,
      ARRAY_AGG(bp.id) AS package_policy_ids,
      COUNT(*)::INTEGER AS package_count
    FROM base_policies bp
    GROUP BY COALESCE(bp.group_id::text, bp.id::text), bp.group_id
  )
  SELECT
    gp.id,
    gp.created_at,
    gp.created_by_id,
    gp.created_by_name,
    gp.created_by_phone,
    gp.branch_name,
    gp.client_id,
    gp.client_name,
    gp.client_file_number,
    gp.client_phone,
    gp.car_number,
    gp.policy_type_parent,
    gp.policy_type_child,
    gp.company_name,
    gp.company_name_ar,
    gp.start_date,
    gp.end_date,
    gp.insurance_price,
    gp.total_paid,
    (gp.insurance_price - gp.total_paid) AS remaining,
    CASE
      WHEN gp.total_paid >= gp.insurance_price THEN 'paid'
      WHEN gp.total_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END AS payment_status,
    COUNT(*) OVER() AS total_rows,
    gp.is_package,
    gp.package_types,
    gp.package_policy_ids,
    gp.package_count
  FROM grouped_policies gp
  ORDER BY gp.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;


-- Create report_renewals with package grouping
CREATE FUNCTION public.report_renewals(
  p_end_month date DEFAULT NULL::date, 
  p_days_remaining integer DEFAULT NULL::integer, 
  p_policy_type text DEFAULT NULL::text, 
  p_created_by uuid DEFAULT NULL::uuid, 
  p_search text DEFAULT NULL::text, 
  p_limit integer DEFAULT 50, 
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, 
  end_date date, 
  days_remaining integer, 
  client_id uuid, 
  client_name text, 
  client_file_number text, 
  client_phone text, 
  car_number text, 
  policy_type_parent text, 
  policy_type_child text, 
  company_name text, 
  company_name_ar text, 
  insurance_price numeric, 
  renewal_status text, 
  renewal_notes text, 
  last_contacted_at timestamp with time zone, 
  reminder_sent_at timestamp with time zone, 
  created_by_id uuid, 
  created_by_name text, 
  group_id uuid, 
  total_rows bigint,
  is_package boolean,
  package_types text[],
  package_policy_ids uuid[],
  package_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_end_month IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', p_end_month)::DATE;
    v_month_end := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month - 1 day')::DATE;
  ELSE
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  END IF;

  RETURN QUERY
  WITH base_policies AS (
    SELECT
      p.id,
      p.end_date,
      (p.end_date - CURRENT_DATE)::INTEGER AS days_remaining,
      p.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      car.car_number,
      p.policy_type_parent::TEXT,
      p.policy_type_child::TEXT,
      ic.name AS company_name,
      ic.name_ar AS company_name_ar,
      p.insurance_price,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status,
      prt.notes AS renewal_notes,
      prt.last_contacted_at,
      prt.reminder_sent_at,
      p.created_by_admin_id AS created_by_id,
      prof.full_name AS created_by_name,
      p.group_id
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    LEFT JOIN profiles prof ON prof.id = p.created_by_admin_id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
      AND can_access_branch(auth.uid(), p.branch_id)
      AND (
        (p_days_remaining IS NOT NULL AND (p.end_date - CURRENT_DATE) <= p_days_remaining AND (p.end_date - CURRENT_DATE) >= 0)
        OR (p_days_remaining IS NULL AND p.end_date >= v_month_start AND p.end_date <= v_month_end)
      )
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone_number ILIKE '%' || p_search || '%' OR
        c.file_number ILIKE '%' || p_search || '%' OR
        car.car_number ILIKE '%' || p_search || '%'
      )
  ),
  grouped_policies AS (
    SELECT
      MIN(bp.id) AS id,
      MIN(bp.end_date) AS end_date,
      MIN(bp.days_remaining) AS days_remaining,
      (array_agg(bp.client_id))[1] AS client_id,
      (array_agg(bp.client_name))[1] AS client_name,
      (array_agg(bp.client_file_number))[1] AS client_file_number,
      (array_agg(bp.client_phone))[1] AS client_phone,
      (array_agg(bp.car_number))[1] AS car_number,
      CASE 
        WHEN bp.group_id IS NOT NULL THEN 'PACKAGE'
        ELSE (array_agg(bp.policy_type_parent))[1]
      END AS policy_type_parent,
      (array_agg(bp.policy_type_child))[1] AS policy_type_child,
      (array_agg(bp.company_name))[1] AS company_name,
      (array_agg(bp.company_name_ar))[1] AS company_name_ar,
      SUM(bp.insurance_price) AS insurance_price,
      MIN(bp.renewal_status) AS renewal_status,
      STRING_AGG(DISTINCT bp.renewal_notes, '; ') AS renewal_notes,
      MAX(bp.last_contacted_at) AS last_contacted_at,
      MAX(bp.reminder_sent_at) AS reminder_sent_at,
      (array_agg(bp.created_by_id))[1] AS created_by_id,
      (array_agg(bp.created_by_name))[1] AS created_by_name,
      bp.group_id,
      CASE WHEN bp.group_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_package,
      ARRAY_AGG(DISTINCT bp.policy_type_parent ORDER BY bp.policy_type_parent) AS package_types,
      ARRAY_AGG(bp.id) AS package_policy_ids,
      COUNT(*)::INTEGER AS package_count
    FROM base_policies bp
    GROUP BY COALESCE(bp.group_id::text, bp.id::text), bp.group_id
  )
  SELECT
    gp.id,
    gp.end_date,
    gp.days_remaining,
    gp.client_id,
    gp.client_name,
    gp.client_file_number,
    gp.client_phone,
    gp.car_number,
    gp.policy_type_parent,
    gp.policy_type_child,
    gp.company_name,
    gp.company_name_ar,
    gp.insurance_price,
    gp.renewal_status,
    gp.renewal_notes,
    gp.last_contacted_at,
    gp.reminder_sent_at,
    gp.created_by_id,
    gp.created_by_name,
    gp.group_id,
    COUNT(*) OVER() AS total_rows,
    gp.is_package,
    gp.package_types,
    gp.package_policy_ids,
    gp.package_count
  FROM grouped_policies gp
  ORDER BY gp.end_date ASC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;
