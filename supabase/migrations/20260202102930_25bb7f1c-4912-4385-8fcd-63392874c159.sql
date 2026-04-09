-- Update report_renewals to exclude policies that have been renewed (newer active policy exists)
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
  worst_renewal_status text, 
  renewal_notes text, 
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offset integer;
  v_total bigint;
  v_policy_type public.policy_type_parent;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;

  -- Count total distinct clients (only those without renewed policies)
  SELECT COUNT(DISTINCT c.id)
  INTO v_total
  FROM policies p
  JOIN clients c ON c.id = p.client_id
  WHERE p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
    AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
    AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
    AND (
      p_search IS NULL
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
      OR c.file_number ILIKE '%' || p_search || '%'
      OR c.id_number ILIKE '%' || p_search || '%'
    )
    -- NEW: Exclude policies that have been renewed (newer policy exists for same car + type)
    AND NOT EXISTS (
      SELECT 1 FROM policies newer
      WHERE newer.client_id = p.client_id
        AND newer.car_id = p.car_id
        AND newer.policy_type_parent = p.policy_type_parent
        AND newer.deleted_at IS NULL
        AND newer.cancelled IS NOT TRUE
        AND newer.transferred IS NOT TRUE
        AND newer.start_date > p.start_date
        AND newer.end_date > CURRENT_DATE
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
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
      )
      -- NEW: Exclude renewed policies
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id = p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.deleted_at IS NULL
          AND newer.cancelled IS NOT TRUE
          AND newer.transferred IS NOT TRUE
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
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
      ARRAY_AGG(DISTINCT cp.policy_type_parent::text) as policy_types,
      ARRAY_AGG(cp.pid) as policy_ids,
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
$function$;

-- Update get_client_renewal_policies to exclude renewed policies
CREATE OR REPLACE FUNCTION public.get_client_renewal_policies(
  p_client_id uuid, 
  p_start_date date DEFAULT NULL::date, 
  p_end_date date DEFAULT NULL::date
)
RETURNS TABLE(
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
  reminder_sent_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.car_id,
    car.car_number,
    p.policy_type_parent::text,
    p.policy_type_child::text,
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
  FROM public.policies p
  LEFT JOIN public.cars car ON car.id = p.car_id
  LEFT JOIN public.insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN public.policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.client_id = p_client_id
    AND p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
    -- NEW: Exclude policies that have been renewed
    AND NOT EXISTS (
      SELECT 1 FROM public.policies newer
      WHERE newer.client_id = p.client_id
        AND newer.car_id = p.car_id
        AND newer.policy_type_parent = p.policy_type_parent
        AND newer.deleted_at IS NULL
        AND newer.cancelled IS NOT TRUE
        AND newer.transferred IS NOT TRUE
        AND newer.start_date > p.start_date
        AND newer.end_date > CURRENT_DATE
    )
  ORDER BY p.end_date ASC;
END;
$function$;

-- Update report_renewals_summary to exclude renewed policies
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month date DEFAULT NULL::date, 
  p_policy_type text DEFAULT NULL::text, 
  p_created_by uuid DEFAULT NULL::uuid, 
  p_search text DEFAULT NULL::text
)
RETURNS TABLE(
  total_expiring bigint, 
  not_contacted bigint, 
  sms_sent bigint, 
  called bigint, 
  renewed bigint, 
  not_interested bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date date;
  v_end_date date;
  v_search_pattern text;
BEGIN
  IF p_end_month IS NOT NULL THEN
    v_start_date := date_trunc('month', p_end_month)::date;
    v_end_date := (date_trunc('month', p_end_month) + interval '1 month - 1 day')::date;
  ELSE
    v_start_date := CURRENT_DATE;
    v_end_date := (CURRENT_DATE + interval '30 days')::date;
  END IF;

  v_search_pattern := CASE WHEN p_search IS NOT NULL AND p_search != '' 
                           THEN '%' || lower(p_search) || '%' 
                           ELSE NULL END;

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
      -- Apply policy type filter
      AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type)
      -- Apply created by filter
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      -- Apply search filter
      AND (v_search_pattern IS NULL OR (
        lower(c.full_name) LIKE v_search_pattern 
        OR c.phone_number LIKE v_search_pattern 
        OR c.id_number LIKE v_search_pattern
        OR c.file_number LIKE v_search_pattern
      ))
      -- NEW: Exclude policies that have been renewed
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id = p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.deleted_at IS NULL
          AND newer.cancelled IS NOT TRUE
          AND newer.transferred IS NOT TRUE
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      )
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
$function$;

-- Update report_renewals_service used by PDF report generation
CREATE OR REPLACE FUNCTION public.report_renewals_service(
  p_end_month date DEFAULT NULL::date, 
  p_days_remaining integer DEFAULT NULL::integer, 
  p_policy_type text DEFAULT NULL::text, 
  p_limit integer DEFAULT 1000, 
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
  total_rows bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  -- Calculate month range
  IF p_end_month IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', p_end_month)::DATE;
    v_month_end := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month - 1 day')::DATE;
  ELSE
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  END IF;

  RETURN QUERY
  WITH filtered_policies AS (
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
      prof.full_name AS created_by_name
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    LEFT JOIN profiles prof ON prof.id = p.created_by_admin_id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
      -- Filter by month or days remaining
      AND (
        (p_days_remaining IS NOT NULL AND (p.end_date - CURRENT_DATE) <= p_days_remaining AND (p.end_date - CURRENT_DATE) >= 0)
        OR (p_days_remaining IS NULL AND p.end_date >= v_month_start AND p.end_date <= v_month_end)
      )
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      -- NEW: Exclude policies that have been renewed
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id = p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.deleted_at IS NULL
          AND newer.cancelled IS NOT TRUE
          AND newer.transferred IS NOT TRUE
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      )
  )
  SELECT
    fp.*,
    COUNT(*) OVER() AS total_rows
  FROM filtered_policies fp
  ORDER BY fp.end_date ASC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;