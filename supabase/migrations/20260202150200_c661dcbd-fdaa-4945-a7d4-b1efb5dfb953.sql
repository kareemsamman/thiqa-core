-- Drop existing functions to recreate with correct return type
DROP FUNCTION IF EXISTS public.report_renewals(date, date, text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.report_renewals_service(date, integer, text, integer, integer);

-- 1. Fix report_renewals - add car_numbers, search by car_number, and fix renewal_status source
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  
  RETURN QUERY
  WITH client_policies AS (
    SELECT 
      c.id as cid,
      c.full_name as cname,
      c.file_number as cfile,
      c.phone_number as cphone,
      p.id as pid,
      p.end_date,
      p.insurance_price,
      p.policy_type_parent,
      COALESCE(prt.renewal_status, 'not_contacted') as rstatus,
      prt.notes as rnotes,
      car.car_number as car_num
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.cancelled = false
      AND p.transferred = false
      AND c.deleted_at IS NULL
      AND p.end_date >= COALESCE(p_start_date, p.end_date)
      AND p.end_date <= COALESCE(p_end_date, p.end_date)
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
      cp.cid,
      cp.cname,
      cp.cfile,
      cp.cphone,
      COUNT(*)::integer as pcount,
      MIN(cp.end_date) as min_end,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(COALESCE(cp.insurance_price, 0)) as total_price,
      ARRAY_AGG(DISTINCT cp.policy_type_parent) FILTER (WHERE cp.policy_type_parent IS NOT NULL) as ptypes,
      ARRAY_AGG(cp.pid) as pids,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      -- Get worst status (priority: not_contacted > sms_sent > called > not_interested > renewed)
      CASE 
        WHEN bool_or(cp.rstatus = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(cp.rstatus = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(cp.rstatus = 'called') THEN 'called'
        WHEN bool_or(cp.rstatus = 'not_interested') THEN 'not_interested'
        ELSE 'renewed'
      END as worst_status,
      STRING_AGG(cp.rnotes, '; ') FILTER (WHERE cp.rnotes IS NOT NULL) as notes_agg
    FROM client_policies cp
    GROUP BY cp.cid, cp.cname, cp.cfile, cp.cphone
  ),
  counted AS (
    SELECT COUNT(*) OVER() as total FROM aggregated
  )
  SELECT 
    a.cid as client_id,
    a.cname as client_name,
    a.cfile as client_file_number,
    a.cphone as client_phone,
    a.pcount as policies_count,
    a.min_end as earliest_end_date,
    a.days_rem as days_remaining,
    a.total_price as total_insurance_price,
    a.ptypes as policy_types,
    a.pids as policy_ids,
    a.car_nums as car_numbers,
    a.worst_status as worst_renewal_status,
    a.notes_agg as renewal_notes,
    (SELECT total FROM counted LIMIT 1) as total_count
  FROM aggregated a
  ORDER BY a.min_end ASC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;

-- 2. Fix report_renewals_service for PDF (grouped by client)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
BEGIN
  -- Calculate month range
  IF p_end_month IS NOT NULL THEN
    v_month_start := date_trunc('month', p_end_month)::date;
    v_month_end := (date_trunc('month', p_end_month) + interval '1 month' - interval '1 day')::date;
  END IF;

  RETURN QUERY
  WITH client_policies AS (
    SELECT 
      c.id as cid,
      c.full_name as cname,
      c.file_number as cfile,
      c.phone_number as cphone,
      p.id as pid,
      p.end_date,
      p.insurance_price,
      p.policy_type_parent,
      COALESCE(prt.renewal_status, 'not_contacted') as rstatus,
      prt.notes as rnotes,
      car.car_number as car_num,
      (p.end_date - CURRENT_DATE)::integer as days_rem
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.cancelled = false
      AND p.transferred = false
      AND c.deleted_at IS NULL
      AND (v_month_start IS NULL OR p.end_date >= v_month_start)
      AND (v_month_end IS NULL OR p.end_date <= v_month_end)
      AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type)
      AND (p_days_remaining IS NULL OR (p.end_date - CURRENT_DATE) <= p_days_remaining)
  ),
  aggregated AS (
    SELECT 
      cp.cid,
      cp.cname,
      cp.cfile,
      cp.cphone,
      COUNT(*)::integer as pcount,
      MIN(cp.end_date) as min_end,
      MIN(cp.days_rem) as min_days,
      SUM(COALESCE(cp.insurance_price, 0)) as total_ins_price,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      ARRAY_AGG(DISTINCT cp.policy_type_parent) FILTER (WHERE cp.policy_type_parent IS NOT NULL) as ptypes,
      -- Get worst status
      CASE 
        WHEN bool_or(cp.rstatus = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(cp.rstatus = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(cp.rstatus = 'called') THEN 'called'
        WHEN bool_or(cp.rstatus = 'not_interested') THEN 'not_interested'
        ELSE 'renewed'
      END as worst_status,
      STRING_AGG(cp.rnotes, '; ') FILTER (WHERE cp.rnotes IS NOT NULL) as notes_agg
    FROM client_policies cp
    GROUP BY cp.cid, cp.cname, cp.cfile, cp.cphone
  ),
  counted AS (
    SELECT COUNT(*) OVER() as total FROM aggregated
  )
  SELECT 
    a.cid as client_id,
    a.cname as client_name,
    a.cfile as client_file_number,
    a.cphone as client_phone,
    a.pcount as policies_count,
    a.min_end as earliest_end_date,
    a.min_days as days_remaining,
    a.total_ins_price as total_price,
    a.car_nums as car_numbers,
    a.ptypes as policy_types,
    a.worst_status as renewal_status,
    a.notes_agg as renewal_notes,
    (SELECT total FROM counted LIMIT 1) as total_rows
  FROM aggregated a
  ORDER BY a.min_end ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;