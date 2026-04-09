-- Drop and recreate report_renewals to group by CLIENT instead of package
-- This returns one row per client with aggregated policy info
DROP FUNCTION IF EXISTS public.report_renewals(date, date, text, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.report_renewals(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1
)
RETURNS TABLE (
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
  v_total bigint;
BEGIN
  v_offset := (p_page - 1) * p_page_size;

  -- Count total distinct clients
  SELECT COUNT(DISTINCT c.id)
  INTO v_total
  FROM policies p
  JOIN clients c ON c.id = p.client_id
  WHERE p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
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
    );

  RETURN QUERY
  WITH client_policies AS (
    SELECT 
      c.id as cid,
      c.full_name,
      c.file_number,
      c.phone_number,
      p.id as pid,
      p.end_date,
      p.insurance_price,
      p.policy_type_parent,
      COALESCE(prt.renewal_status, 'not_contacted') as rstatus,
      prt.notes as rnotes
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
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
      )
  ),
  aggregated AS (
    SELECT
      cp.cid,
      cp.full_name,
      cp.file_number,
      cp.phone_number,
      COUNT(*)::integer as policies_count,
      MIN(cp.end_date) as earliest_end_date,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_remaining,
      SUM(cp.insurance_price) as total_insurance_price,
      ARRAY_AGG(DISTINCT cp.policy_type_parent) as policy_types,
      ARRAY_AGG(cp.pid) as policy_ids,
      -- Worst status: not_contacted > sms_sent > called > renewed/not_interested
      CASE 
        WHEN 'not_contacted' = ANY(ARRAY_AGG(cp.rstatus)) THEN 'not_contacted'
        WHEN 'sms_sent' = ANY(ARRAY_AGG(cp.rstatus)) THEN 'sms_sent'
        WHEN 'called' = ANY(ARRAY_AGG(cp.rstatus)) THEN 'called'
        WHEN 'renewed' = ANY(ARRAY_AGG(cp.rstatus)) THEN 'renewed'
        ELSE 'not_interested'
      END as worst_renewal_status,
      STRING_AGG(DISTINCT cp.rnotes, ' | ') as renewal_notes
    FROM client_policies cp
    GROUP BY cp.cid, cp.full_name, cp.file_number, cp.phone_number
  )
  SELECT
    a.cid,
    a.full_name,
    a.file_number,
    a.phone_number,
    a.policies_count,
    a.earliest_end_date,
    a.days_remaining,
    a.total_insurance_price,
    a.policy_types,
    a.policy_ids,
    a.worst_renewal_status,
    a.renewal_notes,
    v_total
  FROM aggregated a
  ORDER BY a.earliest_end_date ASC, a.full_name ASC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;

-- Update report_renewals_summary to count by clients not policies
DROP FUNCTION IF EXISTS public.report_renewals_summary(date);

CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month date DEFAULT NULL
)
RETURNS TABLE (
  total_expiring bigint,
  not_contacted bigint,
  sms_sent bigint,
  called bigint,
  renewed bigint,
  not_interested bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
BEGIN
  IF p_end_month IS NOT NULL THEN
    v_start_date := date_trunc('month', p_end_month)::date;
    v_end_date := (date_trunc('month', p_end_month) + interval '1 month - 1 day')::date;
  ELSE
    v_start_date := CURRENT_DATE;
    v_end_date := (CURRENT_DATE + interval '30 days')::date;
  END IF;

  RETURN QUERY
  WITH client_statuses AS (
    SELECT 
      c.id as client_id,
      -- Worst status per client
      CASE 
        WHEN 'not_contacted' = ANY(ARRAY_AGG(COALESCE(prt.renewal_status, 'not_contacted'))) THEN 'not_contacted'
        WHEN 'sms_sent' = ANY(ARRAY_AGG(COALESCE(prt.renewal_status, 'not_contacted'))) THEN 'sms_sent'
        WHEN 'called' = ANY(ARRAY_AGG(COALESCE(prt.renewal_status, 'not_contacted'))) THEN 'called'
        WHEN 'renewed' = ANY(ARRAY_AGG(COALESCE(prt.renewal_status, 'not_contacted'))) THEN 'renewed'
        ELSE 'not_interested'
      END as status
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
      AND p.end_date >= v_start_date
      AND p.end_date <= v_end_date
    GROUP BY c.id
  )
  SELECT
    COUNT(*)::bigint as total_expiring,
    COUNT(*) FILTER (WHERE status = 'not_contacted')::bigint as not_contacted,
    COUNT(*) FILTER (WHERE status = 'sms_sent')::bigint as sms_sent,
    COUNT(*) FILTER (WHERE status = 'called')::bigint as called,
    COUNT(*) FILTER (WHERE status = 'renewed')::bigint as renewed,
    COUNT(*) FILTER (WHERE status = 'not_interested')::bigint as not_interested
  FROM client_statuses;
END;
$$;

-- Create a helper function to get detailed policies for a client in the renewal period
CREATE OR REPLACE FUNCTION public.get_client_renewal_policies(
  p_client_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  car_id uuid,
  car_number text,
  policy_type_parent text,
  policy_type_child text,
  company_id uuid,
  company_name text,
  company_name_ar text,
  start_date date,
  end_date date,
  days_remaining integer,
  insurance_price numeric,
  renewal_status text,
  renewal_notes text,
  reminder_sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.car_id,
    car.car_number,
    p.policy_type_parent,
    p.policy_type_child,
    p.company_id,
    ic.name as company_name,
    ic.name_ar as company_name_ar,
    p.start_date,
    p.end_date,
    (p.end_date - CURRENT_DATE)::integer as days_remaining,
    p.insurance_price,
    COALESCE(prt.renewal_status, 'not_contacted') as renewal_status,
    prt.notes as renewal_notes,
    prt.reminder_sent_at
  FROM policies p
  LEFT JOIN cars car ON car.id = p.car_id
  LEFT JOIN insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.client_id = p_client_id
    AND p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
  ORDER BY p.end_date ASC;
END;
$$;