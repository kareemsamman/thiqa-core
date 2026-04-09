-- Fix report_renewals (client-grouped) to compare enum policy_type_parent correctly and return text[]
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
  v_policy_type public.policy_type_parent;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;

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
    AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
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
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
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
$$;