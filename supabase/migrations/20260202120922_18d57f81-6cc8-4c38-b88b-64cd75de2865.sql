-- First drop the existing function, then recreate with fixed logic
DROP FUNCTION IF EXISTS public.report_renewed_clients(text, text, uuid, text, integer, integer);

-- Recreate with correct renewal detection logic
CREATE OR REPLACE FUNCTION public.report_renewed_clients(
  p_end_month text DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  policies_count bigint,
  earliest_end_date date,
  total_insurance_price numeric,
  policy_types text[],
  policy_ids uuid[],
  new_policies_count bigint,
  new_policy_ids uuid[],
  new_policy_types text[],
  new_total_price numeric,
  new_start_date date,
  has_package boolean,
  total_count bigint
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
    -- Find policies that are expiring in the selected month
    -- AND have a newer successor (auto-renewed)
    SELECT
      p.id,
      p.client_id,
      p.car_id,
      p.policy_type_parent AS ptype,
      p.group_id,
      p.insurance_price,
      p.end_date,
      p.start_date
    FROM policies p
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
      -- CRITICAL: Only include policies that have a newer successor
      AND EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.start_date > p.start_date  -- Started after the old policy
          AND newer.end_date > CURRENT_DATE    -- Still active
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.deleted_at IS NULL
      )
  ),
  -- Find the renewal policies for each expiring policy
  renewal_mappings AS (
    SELECT DISTINCT ON (ep.id)
      ep.id AS old_policy_id,
      ep.client_id,
      np.id AS new_policy_id,
      np.policy_type_parent AS new_ptype,
      np.insurance_price AS new_price,
      np.start_date AS new_start,
      np.group_id AS new_group_id
    FROM expiring_policies ep
    JOIN policies np ON 
      np.client_id = ep.client_id
      AND np.car_id IS NOT DISTINCT FROM ep.car_id
      AND np.policy_type_parent = ep.ptype
      AND np.start_date > ep.start_date
      AND np.end_date > CURRENT_DATE
      AND np.cancelled = false
      AND np.transferred = false
      AND np.deleted_at IS NULL
    ORDER BY ep.id, np.start_date ASC
  ),
  -- Aggregate by client
  client_aggregates AS (
    SELECT
      ep.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      COUNT(DISTINCT ep.id) AS policies_count,
      MIN(ep.end_date) AS earliest_end_date,
      COALESCE(SUM(ep.insurance_price), 0) AS total_insurance_price,
      ARRAY_AGG(DISTINCT ep.ptype::text) AS policy_types,
      ARRAY_AGG(DISTINCT ep.id) AS policy_ids,
      -- New policies data
      COUNT(DISTINCT rm.new_policy_id) AS new_policies_count,
      ARRAY_AGG(DISTINCT rm.new_policy_id) FILTER (WHERE rm.new_policy_id IS NOT NULL) AS new_policy_ids,
      ARRAY_AGG(DISTINCT rm.new_ptype::text) FILTER (WHERE rm.new_ptype IS NOT NULL) AS new_policy_types,
      COALESCE(SUM(DISTINCT rm.new_price) FILTER (WHERE rm.new_policy_id IS NOT NULL), 0) AS new_total_price,
      MIN(rm.new_start) AS new_start_date,
      -- Check if has package (group_id not null)
      bool_or(ep.group_id IS NOT NULL OR rm.new_group_id IS NOT NULL) AS has_package
    FROM expiring_policies ep
    JOIN clients c ON c.id = ep.client_id
    LEFT JOIN renewal_mappings rm ON rm.old_policy_id = ep.id
    GROUP BY ep.client_id, c.full_name, c.file_number, c.phone_number
  )
  SELECT
    ca.client_id,
    ca.client_name,
    ca.client_file_number,
    ca.client_phone,
    ca.policies_count,
    ca.earliest_end_date,
    ca.total_insurance_price,
    ca.policy_types,
    ca.policy_ids,
    ca.new_policies_count,
    ca.new_policy_ids,
    ca.new_policy_types,
    ca.new_total_price,
    ca.new_start_date,
    ca.has_package,
    COUNT(*) OVER()::bigint AS total_count
  FROM client_aggregates ca
  ORDER BY ca.earliest_end_date ASC, ca.client_name
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;