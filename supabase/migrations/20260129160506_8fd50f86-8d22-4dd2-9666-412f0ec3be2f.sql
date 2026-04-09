-- Update report_renewals_summary to accept the same filters as report_renewals
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month date DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL
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