-- Fix report_renewals_summary to include auto-renewed policies in the count
-- Previously, policies with a newer successor were excluded via NOT EXISTS before counting
-- Now we detect them and count them as 'renewed'

CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month text DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_policy_type public.policy_type_parent;
BEGIN
  IF p_end_month IS NOT NULL AND p_end_month != '' THEN
    v_month_start := date_trunc('month', p_end_month::date);
    v_month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  ELSE
    v_month_start := date_trunc('month', CURRENT_DATE);
    v_month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  END IF;
  
  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;
  
  RETURN QUERY
  WITH expiring_policies AS (
    SELECT
      p.id,
      p.client_id,
      p.car_id,
      p.policy_type_parent AS ptype,
      p.group_id,
      p.insurance_price,
      -- Check if auto-renewed (newer policy exists for same client+car+type)
      EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.deleted_at IS NULL
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      ) AS is_auto_renewed,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
    FROM policies p
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.end_date BETWEEN v_month_start AND v_month_end
      AND p.cancelled = false
      AND p.transferred = false
      AND p.deleted_at IS NULL
      -- Policy type filter
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
      -- Created by filter
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      -- Search filter
      AND (
        p_search IS NULL OR p_search = '' OR EXISTS (
          SELECT 1 FROM clients c
          WHERE c.id = p.client_id
            AND (
              c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%'
              OR c.file_number ILIKE '%' || p_search || '%'
            )
        )
      )
  ),
  client_statuses AS (
    SELECT
      ep.client_id,
      -- Priority: auto-renewed first, then manual status
      CASE
        WHEN bool_or(ep.is_auto_renewed) THEN 'renewed'
        WHEN bool_or(ep.renewal_status = 'renewed') THEN 'renewed'
        WHEN bool_or(ep.renewal_status = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(ep.renewal_status = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(ep.renewal_status = 'called') THEN 'called'
        ELSE 'not_interested'
      END AS client_status,
      bool_or(ep.group_id IS NOT NULL) AS has_package,
      SUM(ep.insurance_price) AS client_value
    FROM expiring_policies ep
    GROUP BY ep.client_id
  )
  SELECT
    -- Total expiring excludes renewed
    COUNT(*) FILTER (WHERE cs.client_status != 'renewed')::bigint AS total_expiring,
    COUNT(*) FILTER (WHERE cs.client_status = 'not_contacted')::bigint AS not_contacted,
    COUNT(*) FILTER (WHERE cs.client_status = 'sms_sent')::bigint AS sms_sent,
    COUNT(*) FILTER (WHERE cs.client_status = 'called')::bigint AS called,
    COUNT(*) FILTER (WHERE cs.client_status = 'renewed')::bigint AS renewed,
    COUNT(*) FILTER (WHERE cs.client_status = 'not_interested')::bigint AS not_interested,
    COUNT(*) FILTER (WHERE cs.has_package = true AND cs.client_status != 'renewed')::bigint AS total_packages,
    COUNT(*) FILTER (WHERE cs.has_package = false AND cs.client_status != 'renewed')::bigint AS total_single,
    COALESCE(SUM(cs.client_value) FILTER (WHERE cs.client_status != 'renewed'), 0)::numeric AS total_value
  FROM client_statuses cs;
END;
$$;