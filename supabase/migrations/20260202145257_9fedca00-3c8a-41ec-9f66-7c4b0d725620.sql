-- Drop existing functions first to change return type
DROP FUNCTION IF EXISTS public.report_renewals(date, date, text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.report_renewals_service(date, integer, text, integer, integer);

-- =====================================================
-- 1. Update report_renewals to include car_numbers and search by car_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.report_renewals(
  p_start_date date DEFAULT NULL::date, 
  p_end_date date DEFAULT NULL::date, 
  p_policy_type text DEFAULT NULL::text, 
  p_created_by uuid DEFAULT NULL::uuid, 
  p_search text DEFAULT NULL::text, 
  p_page_size integer DEFAULT 25, 
  p_page integer DEFAULT 1
)
RETURNS TABLE(
  client_id uuid, 
  client_name text, 
  client_file_number text, 
  client_phone text, 
  policies_count integer, 
  earliest_end_date date, 
  days_remaining integer, 
  total_insurance_price numeric, 
  policy_types text[], 
  policy_ids uuid[], 
  car_numbers text[],
  worst_renewal_status text, 
  renewal_notes text, 
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offset integer := (p_page - 1) * p_page_size;
BEGIN
  RETURN QUERY
  WITH client_policies AS (
    SELECT 
      p.id as policy_id,
      p.client_id,
      p.end_date,
      p.insurance_price,
      p.policy_type_parent,
      p.renewal_status,
      p.renewal_notes,
      c.full_name,
      c.file_number,
      c.phone_number,
      car.car_number as car_num
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    WHERE 
      p.status = 'active'
      AND p.parent_package_id IS NULL
      AND (p_start_date IS NULL OR p.end_date >= p_start_date)
      AND (p_end_date IS NULL OR p.end_date <= p_end_date)
      AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR car.car_number ILIKE '%' || p_search || '%'
      )
  ),
  aggregated AS (
    SELECT 
      cp.client_id,
      cp.full_name,
      cp.file_number,
      cp.phone_number,
      COUNT(*)::integer as pol_count,
      MIN(cp.end_date) as min_end_date,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(cp.insurance_price) as total_price,
      ARRAY_AGG(DISTINCT cp.policy_type_parent) as types,
      ARRAY_AGG(cp.policy_id) as pol_ids,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      -- Get worst status (priority: not_contacted > sms_sent > called > not_interested > renewed)
      MIN(CASE 
        WHEN cp.renewal_status = 'not_contacted' THEN 1
        WHEN cp.renewal_status = 'sms_sent' THEN 2
        WHEN cp.renewal_status = 'called' THEN 3
        WHEN cp.renewal_status = 'not_interested' THEN 4
        WHEN cp.renewal_status = 'renewed' THEN 5
        ELSE 1
      END) as status_priority,
      STRING_AGG(DISTINCT cp.renewal_notes, '; ') FILTER (WHERE cp.renewal_notes IS NOT NULL) as notes
    FROM client_policies cp
    GROUP BY cp.client_id, cp.full_name, cp.file_number, cp.phone_number
  ),
  total AS (
    SELECT COUNT(*) as cnt FROM aggregated
  )
  SELECT 
    a.client_id,
    a.full_name,
    a.file_number,
    a.phone_number,
    a.pol_count,
    a.min_end_date,
    a.days_rem,
    a.total_price,
    a.types,
    a.pol_ids,
    a.car_nums,
    CASE a.status_priority
      WHEN 1 THEN 'not_contacted'
      WHEN 2 THEN 'sms_sent'
      WHEN 3 THEN 'called'
      WHEN 4 THEN 'not_interested'
      WHEN 5 THEN 'renewed'
      ELSE 'not_contacted'
    END as worst_status,
    a.notes,
    t.cnt
  FROM aggregated a
  CROSS JOIN total t
  ORDER BY a.min_end_date ASC, a.full_name ASC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;

-- =====================================================
-- 2. Update report_renewals_service for PDF (grouped by client)
-- =====================================================
CREATE OR REPLACE FUNCTION public.report_renewals_service(
  p_end_month date DEFAULT NULL::date, 
  p_days_remaining integer DEFAULT NULL::integer, 
  p_policy_type text DEFAULT NULL::text, 
  p_limit integer DEFAULT 1000, 
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  policies_count integer,
  earliest_end_date date,
  days_remaining integer,
  total_price numeric,
  car_numbers text[],
  policy_types text[],
  renewal_status text,
  renewal_notes text,
  total_rows bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
BEGIN
  -- Calculate date range from month
  IF p_end_month IS NOT NULL THEN
    v_start_date := DATE_TRUNC('month', p_end_month)::date;
    v_end_date := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month' - INTERVAL '1 day')::date;
  END IF;
  
  RETURN QUERY
  WITH client_policies AS (
    SELECT 
      p.id as policy_id,
      p.client_id,
      p.end_date,
      p.insurance_price,
      p.policy_type_parent,
      p.renewal_status,
      p.renewal_notes,
      c.full_name,
      c.file_number,
      c.phone_number,
      car.car_number as car_num
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    WHERE 
      p.status = 'active'
      AND p.parent_package_id IS NULL
      AND (v_start_date IS NULL OR p.end_date >= v_start_date)
      AND (v_end_date IS NULL OR p.end_date <= v_end_date)
      AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type)
      AND (p_days_remaining IS NULL OR (p.end_date - CURRENT_DATE) <= p_days_remaining)
  ),
  aggregated AS (
    SELECT 
      cp.client_id,
      cp.full_name,
      cp.file_number,
      cp.phone_number,
      COUNT(*)::integer as pol_count,
      MIN(cp.end_date) as min_end_date,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(cp.insurance_price) as total_ins_price,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      ARRAY_AGG(DISTINCT cp.policy_type_parent) as types,
      -- Get worst status
      MIN(CASE 
        WHEN cp.renewal_status = 'not_contacted' THEN 1
        WHEN cp.renewal_status = 'sms_sent' THEN 2
        WHEN cp.renewal_status = 'called' THEN 3
        WHEN cp.renewal_status = 'not_interested' THEN 4
        WHEN cp.renewal_status = 'renewed' THEN 5
        ELSE 1
      END) as status_priority,
      STRING_AGG(DISTINCT cp.renewal_notes, '; ') FILTER (WHERE cp.renewal_notes IS NOT NULL) as notes
    FROM client_policies cp
    GROUP BY cp.client_id, cp.full_name, cp.file_number, cp.phone_number
  ),
  total AS (
    SELECT COUNT(*) as cnt FROM aggregated
  )
  SELECT 
    a.client_id,
    a.full_name,
    a.file_number,
    a.phone_number,
    a.pol_count,
    a.min_end_date,
    a.days_rem,
    a.total_ins_price,
    a.car_nums,
    a.types,
    CASE a.status_priority
      WHEN 1 THEN 'not_contacted'
      WHEN 2 THEN 'sms_sent'
      WHEN 3 THEN 'called'
      WHEN 4 THEN 'not_interested'
      WHEN 5 THEN 'renewed'
      ELSE 'not_contacted'
    END,
    a.notes,
    t.cnt
  FROM aggregated a
  CROSS JOIN total t
  ORDER BY a.min_end_date ASC, a.full_name ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;