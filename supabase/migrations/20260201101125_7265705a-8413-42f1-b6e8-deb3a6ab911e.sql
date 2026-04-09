-- Drop and recreate find_missing_packages with time bucket grouping
DROP FUNCTION IF EXISTS public.find_missing_packages();

CREATE OR REPLACE FUNCTION public.find_missing_packages()
RETURNS TABLE (
  client_id uuid,
  car_id uuid,
  client_name text,
  car_number text,
  policy_count bigint,
  policy_ids uuid[],
  types text[],
  total_price numeric,
  first_created timestamptz,
  last_created timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH policy_candidates AS (
    SELECT 
      p.id, p.client_id, p.car_id, p.policy_type_parent,
      p.insurance_price, p.created_at,
      c.full_name as client_name, cr.car_number,
      -- Create a time window bucket (rounded to hour)
      date_trunc('hour', p.created_at) as time_bucket
    FROM policies p
    JOIN clients c ON p.client_id = c.id
    JOIN cars cr ON p.car_id = cr.id
    WHERE p.group_id IS NULL
      AND p.cancelled = false
  )
  SELECT 
    pc.client_id, 
    pc.car_id, 
    pc.client_name, 
    pc.car_number,
    COUNT(*) as policy_count,
    array_agg(pc.id ORDER BY pc.created_at) as policy_ids,
    array_agg(pc.policy_type_parent::text) as types,
    COALESCE(SUM(pc.insurance_price), 0) as total_price,
    MIN(pc.created_at) as first_created,
    MAX(pc.created_at) as last_created
  FROM policy_candidates pc
  -- Group by time bucket to separate policies created at different times
  GROUP BY pc.client_id, pc.car_id, pc.client_name, pc.car_number, pc.time_bucket
  HAVING COUNT(*) > 1
  ORDER BY MIN(pc.created_at) DESC;
$$;