-- Create RPC function to find missing packages
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
      c.full_name as client_name, cr.car_number
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
  GROUP BY pc.client_id, pc.car_id, pc.client_name, pc.car_number
  HAVING COUNT(*) > 1
    AND (MAX(pc.created_at) - MIN(pc.created_at)) < interval '1 hour'
  ORDER BY MIN(pc.created_at) DESC;
$$;