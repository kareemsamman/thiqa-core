-- First drop the existing function since we're changing return type
DROP FUNCTION IF EXISTS public.report_renewals_summary(date, text, uuid, text);

-- Recreate with new return columns: total_packages, total_single, total_value
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month date DEFAULT NULL,
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
BEGIN
  -- Calculate date range from month
  IF p_end_month IS NOT NULL THEN
    v_start_date := date_trunc('month', p_end_month);
    v_end_date := (date_trunc('month', p_end_month) + interval '1 month - 1 day')::date;
  ELSE
    -- Default to current month
    v_start_date := date_trunc('month', current_date);
    v_end_date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  END IF;

  RETURN QUERY
  WITH base_policies AS (
    SELECT 
      p.id,
      p.client_id,
      p.insurance_price,
      p.group_id,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
    FROM policies p
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.end_date >= v_start_date
      AND p.end_date <= v_end_date
      AND COALESCE(p.cancelled, false) = false
      AND COALESCE(p.transferred, false) = false
      -- Check no newer active policy exists for same car+type
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.car_id = p.car_id
          AND newer.car_id IS NOT NULL
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.start_date > p.end_date
          AND newer.end_date > current_date
          AND COALESCE(newer.cancelled, false) = false
          AND COALESCE(newer.transferred, false) = false
      )
      -- Apply filters
      AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR EXISTS (
        SELECT 1 FROM clients c 
        WHERE c.id = p.client_id 
        AND (
          c.full_name ILIKE '%' || p_search || '%' OR
          c.id_number ILIKE '%' || p_search || '%' OR
          c.phone_number ILIKE '%' || p_search || '%' OR
          c.file_number ILIKE '%' || p_search || '%'
        )
      ))
  ),
  -- Aggregate by client to count unique clients
  client_stats AS (
    SELECT 
      bp.client_id,
      COUNT(DISTINCT bp.id) AS policy_count,
      SUM(bp.insurance_price) AS client_total_value,
      -- A client has packages if they have multiple policies with same group_id
      CASE WHEN COUNT(DISTINCT bp.group_id) FILTER (WHERE bp.group_id IS NOT NULL) > 0 
           AND COUNT(bp.id) FILTER (WHERE bp.group_id IS NOT NULL) > 1 
           THEN true ELSE false END AS has_package,
      -- Get worst status for the client
      MAX(bp.renewal_status) AS worst_status
    FROM base_policies bp
    GROUP BY bp.client_id
  ),
  summary AS (
    SELECT
      COUNT(DISTINCT bp.client_id) AS total_clients,
      COUNT(DISTINCT bp.client_id) FILTER (WHERE COALESCE(prt.renewal_status, 'not_contacted') = 'not_contacted') AS not_contacted_count,
      COUNT(DISTINCT bp.client_id) FILTER (WHERE prt.renewal_status = 'sms_sent') AS sms_sent_count,
      COUNT(DISTINCT bp.client_id) FILTER (WHERE prt.renewal_status = 'called') AS called_count,
      COUNT(DISTINCT bp.client_id) FILTER (WHERE prt.renewal_status = 'renewed') AS renewed_count,
      COUNT(DISTINCT bp.client_id) FILTER (WHERE prt.renewal_status = 'not_interested') AS not_interested_count,
      -- Package counts from client_stats
      (SELECT COUNT(*) FROM client_stats WHERE has_package = true) AS packages_count,
      (SELECT COUNT(*) FROM client_stats WHERE has_package = false) AS single_count,
      -- Total value across all policies
      COALESCE(SUM(bp.insurance_price), 0) AS total_price
    FROM base_policies bp
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = bp.id
  )
  SELECT 
    s.total_clients::bigint,
    s.not_contacted_count::bigint,
    s.sms_sent_count::bigint,
    s.called_count::bigint,
    s.renewed_count::bigint,
    s.not_interested_count::bigint,
    s.packages_count::bigint,
    s.single_count::bigint,
    s.total_price::numeric
  FROM summary s;
END;
$$;