-- Create function to get renewed clients (clients whose policies have been renewed)
CREATE OR REPLACE FUNCTION public.report_renewed_clients(
  p_end_month text DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size int DEFAULT 25,
  p_page int DEFAULT 1
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
  -- New policy info
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
  v_offset int;
BEGIN
  IF p_end_month IS NOT NULL AND p_end_month != '' THEN
    v_month_start := date_trunc('month', p_end_month::date);
    v_month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  ELSE
    v_month_start := date_trunc('month', CURRENT_DATE);
    v_month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  END IF;
  
  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;
  v_offset := (p_page - 1) * p_page_size;
  
  RETURN QUERY
  WITH expiring_policies AS (
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
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
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
      -- Only include policies that have a newer successor (auto-renewed)
      AND EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.deleted_at IS NULL
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      )
  ),
  client_groups AS (
    SELECT
      ep.client_id,
      c.full_name,
      c.file_number,
      c.phone_number,
      COUNT(DISTINCT ep.id) AS policies_count,
      MIN(ep.end_date) AS earliest_end_date,
      SUM(ep.insurance_price) AS total_insurance_price,
      ARRAY_AGG(DISTINCT ep.ptype::text) AS policy_types,
      ARRAY_AGG(DISTINCT ep.id) AS policy_ids,
      bool_or(ep.group_id IS NOT NULL) AS has_package
    FROM expiring_policies ep
    JOIN clients c ON c.id = ep.client_id
    GROUP BY ep.client_id, c.full_name, c.file_number, c.phone_number
  ),
  with_new_policies AS (
    SELECT
      cg.*,
      (
        SELECT COUNT(DISTINCT np.id)
        FROM policies np
        WHERE np.client_id = cg.client_id
          AND np.cancelled = false
          AND np.transferred = false
          AND np.deleted_at IS NULL
          AND np.end_date > CURRENT_DATE
          AND np.start_date > cg.earliest_end_date - interval '30 days'
      ) AS new_policies_count,
      (
        SELECT ARRAY_AGG(DISTINCT np.id)
        FROM policies np
        WHERE np.client_id = cg.client_id
          AND np.cancelled = false
          AND np.transferred = false
          AND np.deleted_at IS NULL
          AND np.end_date > CURRENT_DATE
          AND np.start_date > cg.earliest_end_date - interval '30 days'
      ) AS new_policy_ids,
      (
        SELECT ARRAY_AGG(DISTINCT np.policy_type_parent::text)
        FROM policies np
        WHERE np.client_id = cg.client_id
          AND np.cancelled = false
          AND np.transferred = false
          AND np.deleted_at IS NULL
          AND np.end_date > CURRENT_DATE
          AND np.start_date > cg.earliest_end_date - interval '30 days'
      ) AS new_policy_types,
      (
        SELECT COALESCE(SUM(np.insurance_price), 0)
        FROM policies np
        WHERE np.client_id = cg.client_id
          AND np.cancelled = false
          AND np.transferred = false
          AND np.deleted_at IS NULL
          AND np.end_date > CURRENT_DATE
          AND np.start_date > cg.earliest_end_date - interval '30 days'
      ) AS new_total_price,
      (
        SELECT MIN(np.start_date)
        FROM policies np
        WHERE np.client_id = cg.client_id
          AND np.cancelled = false
          AND np.transferred = false
          AND np.deleted_at IS NULL
          AND np.end_date > CURRENT_DATE
          AND np.start_date > cg.earliest_end_date - interval '30 days'
      ) AS new_start_date
    FROM client_groups cg
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM with_new_policies
  )
  SELECT
    wnp.client_id,
    wnp.full_name AS client_name,
    wnp.file_number AS client_file_number,
    wnp.phone_number AS client_phone,
    wnp.policies_count,
    wnp.earliest_end_date,
    wnp.total_insurance_price,
    wnp.policy_types,
    wnp.policy_ids,
    wnp.new_policies_count,
    wnp.new_policy_ids,
    wnp.new_policy_types,
    wnp.new_total_price,
    wnp.new_start_date,
    wnp.has_package,
    t.cnt AS total_count
  FROM with_new_policies wnp
  CROSS JOIN total t
  ORDER BY wnp.new_start_date DESC NULLS LAST, wnp.earliest_end_date ASC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;