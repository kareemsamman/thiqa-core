-- Drop conflicting function versions
DROP FUNCTION IF EXISTS public.report_renewals_summary(date, text, uuid, text);
DROP FUNCTION IF EXISTS public.report_renewals_summary(text, text, uuid, text);

-- Create unified function with TEXT signature
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month text DEFAULT NULL,
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
  not_interested bigint,
  total_packages bigint,
  total_single bigint,
  total_value numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  month_start date;
  month_end date;
BEGIN
  -- Parse month parameter (format: YYYY-MM-DD or YYYY-MM)
  IF p_end_month IS NULL THEN
    month_start := date_trunc('month', CURRENT_DATE)::date;
    month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  ELSE
    month_start := date_trunc('month', p_end_month::date)::date;
    month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  END IF;

  RETURN QUERY
  WITH expiring_policies AS (
    SELECT 
      p.id,
      p.client_id,
      p.group_id,
      p.insurance_price,
      p.policy_type_parent,
      -- Check if auto-renewed (newer policy exists for same client/car/type)
      EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      ) AS is_auto_renewed,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
    FROM policies p
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false
      AND p.transferred = false
      AND p.deleted_at IS NULL
      -- Policy type filter
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      -- Creator filter
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      -- Search filter
      AND (
        p_search IS NULL 
        OR p_search = ''
        OR EXISTS (
          SELECT 1 FROM clients c 
          WHERE c.id = p.client_id 
          AND (
            c.full_name ILIKE '%' || p_search || '%'
            OR c.id_number ILIKE '%' || p_search || '%'
            OR c.phone_number ILIKE '%' || p_search || '%'
          )
        )
      )
  ),
  -- Determine final status per policy (auto-renewed overrides tracking status)
  policies_with_status AS (
    SELECT
      ep.id,
      ep.client_id,
      ep.group_id,
      ep.insurance_price,
      CASE 
        WHEN ep.is_auto_renewed THEN 'renewed'
        ELSE ep.renewal_status
      END AS final_status,
      ep.group_id IS NOT NULL AS has_package
    FROM expiring_policies ep
  ),
  -- Aggregate by client (one row per client)
  client_statuses AS (
    SELECT 
      pws.client_id,
      -- Use the "worst" status per client (priority: not_contacted > sms_sent > called > renewed > not_interested)
      CASE 
        WHEN bool_or(pws.final_status = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(pws.final_status = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(pws.final_status = 'called') THEN 'called'
        WHEN bool_or(pws.final_status = 'renewed') THEN 'renewed'
        WHEN bool_or(pws.final_status = 'not_interested') THEN 'not_interested'
        ELSE 'not_contacted'
      END AS status,
      bool_or(pws.has_package) AS has_package,
      SUM(pws.insurance_price) AS total_value
    FROM policies_with_status pws
    GROUP BY pws.client_id
  )
  SELECT
    COUNT(*)::bigint AS total_expiring,
    COUNT(*) FILTER (WHERE cs.status = 'not_contacted')::bigint AS not_contacted,
    COUNT(*) FILTER (WHERE cs.status = 'sms_sent')::bigint AS sms_sent,
    COUNT(*) FILTER (WHERE cs.status = 'called')::bigint AS called,
    COUNT(*) FILTER (WHERE cs.status = 'renewed')::bigint AS renewed,
    COUNT(*) FILTER (WHERE cs.status = 'not_interested')::bigint AS not_interested,
    COUNT(*) FILTER (WHERE cs.has_package AND cs.status != 'renewed')::bigint AS total_packages,
    COUNT(*) FILTER (WHERE NOT cs.has_package AND cs.status != 'renewed')::bigint AS total_single,
    COALESCE(SUM(cs.total_value) FILTER (WHERE cs.status != 'renewed'), 0)::numeric AS total_value
  FROM client_statuses cs;
END;
$$;