
-- Report: clients with outstanding debt (paginated)
CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  phone_number text,
  total_owed numeric,
  policies_count integer,
  earliest_expiry date,
  days_until_expiry integer,
  total_rows bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH policy_debt AS (
  SELECT
    p.id AS policy_id,
    p.client_id,
    p.end_date::date AS end_date,
    (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0))::numeric AS remaining
  FROM public.policies p
  LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
  GROUP BY p.id, p.client_id, p.end_date, p.insurance_price
),
client_debt AS (
  SELECT
    c.id AS client_id,
    c.full_name AS client_name,
    c.phone_number AS phone_number,
    SUM(pd.remaining)::numeric AS total_owed,
    COUNT(*)::int AS policies_count,
    MIN(pd.end_date) AS earliest_expiry
  FROM policy_debt pd
  JOIN public.clients c ON c.id = pd.client_id
  WHERE pd.remaining > 0
    AND public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), c.branch_id)
    AND (
      p_search IS NULL
      OR c.full_name ILIKE ('%' || p_search || '%')
      OR c.phone_number ILIKE ('%' || p_search || '%')
    )
  GROUP BY c.id, c.full_name, c.phone_number
),
filtered AS (
  SELECT
    cd.*,
    (cd.earliest_expiry - CURRENT_DATE)::int AS days_until_expiry
  FROM client_debt cd
  WHERE p_filter_days IS NULL
     OR (cd.earliest_expiry - CURRENT_DATE) <= p_filter_days
)
SELECT
  f.client_id,
  f.client_name,
  f.phone_number,
  f.total_owed,
  f.policies_count,
  f.earliest_expiry,
  f.days_until_expiry,
  COUNT(*) OVER() AS total_rows
FROM filtered f
ORDER BY f.total_owed DESC
LIMIT GREATEST(p_limit, 0)
OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.report_client_debts(text, integer, integer, integer) TO authenticated;
